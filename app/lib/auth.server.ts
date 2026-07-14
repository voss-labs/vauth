import { betterAuth, APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import * as schema from "~/db";
import {
  ADMIN_ROLES,
  ALLOWED_EMAIL_DOMAIN,
  ROLES,
  isInstitutionalEmail,
} from "~/lib/config";
import { ac, roles } from "~/lib/permissions";
import { sendOTP } from "~/lib/email.server";

// Everything below is built LAZILY, on first access, and this is not optional.
//
// Module scope on Workers runs at isolate boot — before any request exists, and
// therefore before secrets are injected. Reading process.env.DATABASE_URL there
// yields undefined however correctly the secret is set, and neon() throws:
//   "No database connection string was provided to `neon()`"
// `wrangler dev` hides this, because it populates process.env from .dev.vars at
// startup. The real runtime does not.
//
// Deferring to first access puts construction inside a request, where secrets
// exist. The instances are cached, so better-auth's router is still built once
// per isolate rather than per request (see issue #10188).

let dbInstance: ReturnType<typeof buildDb> | null = null;
let authInstance: ReturnType<typeof buildAuth> | null = null;

function buildDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

export function getDb() {
  return (dbInstance ??= buildDb());
}

function getAuth() {
  return (authInstance ??= buildAuth());
}

// `auth` stays a plain export so call sites — and the better-auth schema CLI —
// keep working unchanged. The proxy is what defers construction.
export const auth = new Proxy({} as ReturnType<typeof buildAuth>, {
  get(_target, prop) {
    const instance = getAuth();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

function buildAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,

    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
      // neon-http cannot open interactive transactions. Flipping this on silently
      // breaks user creation.
      transaction: false,
    }),

    // No passwords, deliberately. The verified institutional mailbox IS the
    // credential; a password would be a second, weaker secret on the same door.
    // It also keeps scrypt — which does not fit the Workers free-tier CPU budget
    // — out of the request path. Enabling this would break the deployment.
    emailAndPassword: { enabled: false },

    // The jwt plugin mounts /token, which collides with /oauth2/token.
    disabledPaths: ["/token"],

    user: {
      additionalFields: {
        // Survives graduation. VIT revokes @vit.edu.in on a known date, and with
        // passwordless there is no fallback credential — without this, every user
        // (including the super_admin) is permanently locked out the day they leave.
        recoveryEmail: { type: "string", required: false, input: true },
        recoveryEmailVerifiedAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },

    // No backgroundTasks handler, deliberately. better-auth only awaits deferred
    // work when this is absent (see runInBackgroundOrAwait in create-context.mjs).
    // Awaiting keeps the OTP send inside the request, which is the only way to know
    // it failed before the response is written — and it costs no CPU, because the
    // Resend call is I/O. Wiring a handler here would restore the silent lockout.

    hooks: {
      // Gate 1 of 3. Without this, better-auth writes the OTP row BEFORE calling
      // sendVerificationOTP, so anyone could fill the verification table with rows
      // for arbitrary addresses. Rejecting on domain leaks nothing — the @vit.edu.in
      // restriction is public policy. We still return success for unknown VIT
      // addresses, so account enumeration stays impossible.
      before: createAuthMiddleware(async (ctx) => {
        const email = (ctx.body as { email?: string } | undefined)?.email;
        if (email && !isInstitutionalEmail(email)) {
          throw new APIError("BAD_REQUEST", {
            message: `Only @${ALLOWED_EMAIL_DOMAIN} addresses can sign in.`,
          });
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Last line of defence. sendVerificationOTP already refuses non-VIT
            // addresses, but a user row must never come into existence without an
            // institutional email — that is the entire registration gate.
            if (!isInstitutionalEmail(user.email)) {
              throw new APIError("BAD_REQUEST", {
                message: `Registration is restricted to @${ALLOWED_EMAIL_DOMAIN} addresses.`,
              });
            }
            return { data: { ...user, role: ROLES.USER } };
          },
        },
      },
    },

    plugins: [
      jwt(),

      admin({
        ac,
        roles,
        defaultRole: ROLES.USER,
        adminRoles: ADMIN_ROLES,
      }),

      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp, type }) {
          if (!isInstitutionalEmail(email)) {
            throw new APIError("BAD_REQUEST", {
              message: `Only @${ALLOWED_EMAIL_DOMAIN} addresses can sign in.`,
            });
          }
          await sendOTP({ email, otp, type });
        },
      }),

      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
      }),
    ],
  });
}
