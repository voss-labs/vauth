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
  ALLOWED_EMAIL_DOMAINS_LABEL,
  GITHUB_PROVIDER_ID,
  ROLES,
  deriveName,
  isInstitutionalEmail,
} from "~/lib/config";
import { ac, roles } from "~/lib/permissions";
import { audit } from "~/lib/audit.server";
import { sendOTP } from "~/lib/email.server";
import { kvRateLimitStorage } from "~/lib/rate-limit-kv";

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

    // Better Auth's limiter only auto-enables when it detects NODE_ENV
    // production, which Workers does not set — so on a passwordless IdP the
    // primary abuse vector (spamming OTP sends, brute-forcing the 6-digit code)
    // was undefended. Turn it on explicitly, and tighten the OTP paths.
    //
    // customStorage backs it with Workers KV so the counts survive across
    // isolates — the in-memory default was per-isolate and dilutable by rotating
    // isolates. NOT global secondaryStorage, which would also relocate sessions
    // into eventually-consistent KV; customStorage is scoped to rate limiting.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customStorage: kvRateLimitStorage(),
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 5 },
      },
    },

    advanced: {
      ipAddress: {
        // Not cosmetic. Without a resolvable client IP, better-auth's rate
        // limiter falls back to ONE SHARED BUCKET for every caller — so a single
        // attacker spamming OTP requests would exhaust the allowance the whole
        // college shares. On a passwordless system that is the primary abuse
        // vector, so this is the control that stops it.
        //
        // cf-connecting-ip is the only header worth trusting here: Cloudflare
        // overwrites it on every request, so a client cannot forge it. Trusting
        // x-forwarded-for instead would let anyone spoof their way into a fresh
        // rate-limit bucket per request.
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },

    // GitHub is a linkable identity, never a signup path. First sign-in is
    // always the @vit.edu.in OTP flow above, which proves current affiliation;
    // linking on /account then pins a durable identity that survives the day
    // VIT revokes the mailbox. `disableSignUp: true` is the affiliation gate:
    // a GitHub sign-in without a pre-existing user is rejected outright, so no
    // one can create a VOSS account without ever verifying a college address.
    //
    // GitHub OAuth is federated identity, not a stored secret, so CONTRIBUTING
    // rule 1 (no passwords) still holds; scrypt still stays out of the request
    // path. And the provider is registered only when both env vars are present,
    // so a dev environment without credentials simply does not advertise it,
    // matching how missing RESEND_API_KEY falls back to console-logged OTPs.
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          socialProviders: {
            github: {
              clientId: process.env.GITHUB_CLIENT_ID,
              clientSecret: process.env.GITHUB_CLIENT_SECRET,
              // Default scopes (`read:user`, `user:email`) are added by the
              // github provider factory itself; setting them here again would
              // duplicate them in the authorization URL.
              disableSignUp: true,
            },
          },
        }
      : {}),

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

    account: {
      // GitHub returns a non-expiring personal-scope access token carrying
      // `read:user` + `user:email`. Persisting it in cleartext in Neon would
      // add standing blast radius to a passwordless identity provider, so
      // encrypt at rest with the BETTER_AUTH_SECRET. Better Auth's
      // `setTokenUtil` gates encryption on this flag (see oauth2/utils.mjs),
      // and the value is NOT retroactive: rows written before this landed
      // stay plaintext, so any pre-flag `provider_id='github'` account rows
      // should be dropped and re-linked before real users depend on it.
      encryptOAuthTokens: true,
      accountLinking: {
        // Manual link via /account is the only supported linking path. A
        // student's @vit.edu.in mailbox will never match their personal GitHub
        // email, so the default same-email requirement would block every real
        // user. `disableImplicitLinking` closes the other side of the same door:
        // Better Auth otherwise auto-links on sign-in when a matching email is
        // found via a trusted provider, and we do not want a stray email match
        // to attach the wrong GitHub identity to a VIT account. The takeover
        // risk called out on `allowDifferentEmails` does not apply here because
        // linking is behind an authenticated session and github signup is
        // already gated off by `disableSignUp: true` above.
        allowDifferentEmails: true,
        disableImplicitLinking: true,
        // Better Auth refuses to remove the last account by default, and
        // email-OTP does not create an `account` row, so a lone GitHub row IS
        // the last account for every user. Allowing unlink is safe as an auth
        // primitive because @vit.edu.in OTP is not gated on the account
        // table; the UI in `app/routes/account.tsx` is what actually protects
        // an alumnus signed in via GitHub with no other way in: the Unlink
        // button is only rendered when a verified `recoveryEmail` exists.
        allowUnlinkingAll: true,
      },
    },

    session: {
      // Better Auth's `freshSessionMiddleware` fences /unlink-account (and
      // /change-password, /delete-user etc.) behind `now - session.createdAt
      // < freshAge`, defaulting to 86400s. Session refresh touches only
      // `expiresAt`/`updatedAt`, never `createdAt`, so on the default 7-day
      // session the Unlink form 403s for six of every seven days. vauth has
      // no re-auth flow that could refresh the fresh-clock (passwordless,
      // and the sensitive endpoints gated by this middleware other than
      // /unlink-account are all disabled here). Setting `freshAge: 0`
      // disables the gate globally, which for this IdP is the right shape:
      // holding a valid session cookie already required proving the
      // institutional mailbox works.
      freshAge: 0,
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
            message: `Only ${ALLOWED_EMAIL_DOMAINS_LABEL} addresses can sign in.`,
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
                message: `Registration is restricted to ${ALLOWED_EMAIL_DOMAINS_LABEL} addresses.`,
              });
            }
            // Never mint a nameless identity: `name` is the whole content of
            // the OIDC profile scope, and a relying party that stores it NOT
            // NULL rejects the login with `name_is_missing` — after the OAuth
            // dance has already succeeded.
            const name = user.name?.trim() || deriveName(user.email);
            return { data: { ...user, name, role: ROLES.USER } };
          },
        },
      },
      account: {
        // Fires for any provider (credential, oauth callbacks, /link-social).
        // Filter to github so the audit log stays a signal of federated-identity
        // changes, not noise from the primary OTP flow.
        //
        // Every other audit call site in the app passes actor email + the
        // incoming request so the row retains an IP and a user agent after
        // the account row it points at is gone (see the comment on `actorId`
        // in `app/db/audit.ts`). `databaseHooks` hands us the endpoint
        // context, which carries both. Wrapped in try/catch so a Neon hiccup
        // in the audit write does not 500 the operation being audited: the
        // account row change has already committed by the time these fire.
        create: {
          after: async (account, ctx) => {
            if (account.providerId !== GITHUB_PROVIDER_ID) return;
            try {
              await audit(getDb(), {
                action: "user.github_linked",
                actorId: account.userId,
                actorEmail: ctx?.context.session?.user?.email ?? null,
                targetType: "account",
                targetId: account.id,
                details: { providerAccountId: account.accountId },
                request: ctx?.request,
              });
            } catch (err) {
              console.error("audit user.github_linked failed", err);
            }
          },
        },
        delete: {
          after: async (account, ctx) => {
            if (account.providerId !== GITHUB_PROVIDER_ID) return;
            try {
              await audit(getDb(), {
                action: "user.github_unlinked",
                actorId: account.userId,
                actorEmail: ctx?.context.session?.user?.email ?? null,
                targetType: "account",
                targetId: account.id,
                details: { providerAccountId: account.accountId },
                request: ctx?.request,
              });
            } catch (err) {
              console.error("audit user.github_unlinked failed", err);
            }
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
        allowedAttempts: 3,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp, type }) {
          if (!isInstitutionalEmail(email)) {
            throw new APIError("BAD_REQUEST", {
              message: `Only ${ALLOWED_EMAIL_DOMAINS_LABEL} addresses can sign in.`,
            });
          }
          await sendOTP({ email, otp, type });
        },
      }),

      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",

        // A false alarm: routes/well-known.ts DOES serve
        // /.well-known/oauth-authorization-server/api/auth (verified 200 in
        // production). better-auth cannot see routes mounted outside its own
        // handler, so it warns on every single discovery request.
        silenceWarnings: { oauthAuthServerConfig: true },
      }),
    ],
  });
}
