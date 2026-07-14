import { betterAuth, APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import * as schema from "~/db/schema";
import {
  ADMIN_ROLES,
  ALLOWED_EMAIL_DOMAIN,
  ROLES,
  isInstitutionalEmail,
} from "~/lib/config";
import { ac, roles } from "~/lib/permissions";
import { sendOTP } from "~/lib/email.server";

// process.env rather than `cloudflare:workers`: it works on Workers under
// nodejs_compat, and unlike the cloudflare module it also loads under plain
// Node, which the better-auth schema CLI needs.
const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
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
