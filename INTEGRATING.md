# Integrating a product with vauth

vauth is the identity provider for every VOSS product. It runs at
`accounts.vosslabs.org` and speaks OAuth 2.1 and OpenID Connect. Your product is
a relying party: it sends people to vauth to sign in and gets back a verified
college identity.

This guide is how VERP and vroom are wired up, written so the next product can
copy it. [VERP](https://github.com/voss-labs/verp) (Next.js, Postgres) is the
reference integration. [vroom](https://github.com/voss-labs/vroom) (React Router
on Cloudflare Workers) shows what changes on Workers. Both use
[better-auth](https://better-auth.com) as the client library, and this guide
assumes you will too.

**There are two questions, and each is answered in a different place.** vauth
answers *who is this person*: it sends a one-time code to their college mailbox,
and that is the login. Your product answers *who is this person here*: their
role, their class, what they may touch. vauth never answers the second question,
and your product must never try to answer the first.

## What vauth gives you

| | |
| --- | --- |
| Issuer | `https://accounts.vosslabs.org/api/auth` |
| Discovery | `https://accounts.vosslabs.org/api/auth/.well-known/openid-configuration` |
| Scopes | `openid profile email` (`offline_access` is also supported) |
| Flow | Authorization code with PKCE `S256`. PKCE is **required** |
| Client auth | `client_secret_post` (`client_secret_basic` also works) |
| ID token signing | `EdDSA` |

The claims you can rely on:

| Claim | What it means |
| --- | --- |
| `sub` | Stable vauth user id |
| `email` | Always an `@vit.edu.in` or `@vosslabs.org` address, and always verified. vauth enforces the domain; you do not need to re-check it |
| `email_verified` | `true` |
| `name` | Usually present. Treat it as optional anyway (see `mapProfileToUser` below) |
| `picture` | Optional |

What vauth does **not** give you: roles, roll numbers, departments, divisions,
employee ids. Those live in your product's own records. vauth cannot verify a roll
number, so it never stores one.

Once GitHub federation lands (#4), a user can also sign in to vauth with a linked
GitHub account. That makes no difference to you: you still receive their verified
college email.

## 1. Request a client

Products are registered in [`clients.config.ts`](clients.config.ts), through a
pull request. An admin cannot add a product from a web console, and that is on
purpose: the list of products that can sign students in should change only
through a reviewed PR.

Add an entry:

```ts
{
  name: "vboard",
  description: "Campus events platform.",
  redirectUris: [
    "https://vboard.vosslabs.org/api/auth/oauth2/callback/voss",
    "http://localhost:5173/api/auth/oauth2/callback/voss",
  ],
  scopes: ["openid", "profile", "email"],
  firstParty: true,
},
```

- **`redirectUris` are the security boundary.** Anyone who can add a redirect URI
  can steal every login. Matching is exact: no wildcards, no trailing slash, and
  the scheme and port must match.
- With better-auth the callback is always
  `<your origin>/api/auth/oauth2/callback/voss`. The final `voss` is the
  `providerId` in your config. Change one and you must change the other.
- Register localhost with the port your dev server **actually** uses: 3000 for
  Next.js, 5173 for Vite and React Router.
- **Get the URIs right the first time.** `npm run clients` registers products it
  has not seen before. It does not update an existing product's redirect URIs.
  Changing them later means asking a maintainer.
- `firstParty: true` skips the consent screen. Use it only for products VOSS
  owns. Anything else sets it to `false`, and users are asked explicitly.

Once the PR merges, a maintainer runs `npm run clients`. That prints
`VOSS_CLIENT_ID` and `VOSS_CLIENT_SECRET` **once**: the secret is hashed at rest
and cannot be read back. The maintainer hands it to the product's owner over a
private channel, never in an issue, PR, or group chat. If the secret is lost, it
gets rotated (`npm run clients:rotate`), not recovered.

## 2. Environment

```sh
BETTER_AUTH_SECRET=        # openssl rand -base64 32
BETTER_AUTH_URL=           # your product's own origin, e.g. http://localhost:3000

VOSS_DISCOVERY_URL="https://accounts.vosslabs.org/api/auth/.well-known/openid-configuration"
VOSS_CLIENT_ID=
VOSS_CLIENT_SECRET=
```

`BETTER_AUTH_SECRET` is still required, even though vauth does the signing in.
better-auth uses it to sign your product's own session cookie and the PKCE and
state cookies for the handshake.

A local `.env` is never deployed. Set these in your host's environment settings:
on Vercel that is the project's environment variables, and on Workers it is
`wrangler secret put`.

## 3. Server: better-auth config

This is VERP's `src/lib/auth.ts`, reduced to what every product needs:

```ts
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { genericOAuth } from "better-auth/plugins"
import { nextCookies } from "better-auth/next-js"
import { db } from "@/db"

function deriveNameFromEmail(email: string): string {
  const local = email?.split("@")[0] ?? ""
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || email
  )
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  emailAndPassword: { enabled: false },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["voss"],
      allowDifferentEmails: false,
    },
  },

  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "voss",
          discoveryUrl: process.env.VOSS_DISCOVERY_URL!,
          clientId: process.env.VOSS_CLIENT_ID!,
          clientSecret: process.env.VOSS_CLIENT_SECRET!,
          scopes: ["openid", "profile", "email"],
          pkce: true,
          requireIssuerValidation: true,
          mapProfileToUser: (profile) => ({
            name: profile.name?.trim() || deriveNameFromEmail(profile.email),
          }),
        },
      ],
    }),
    nextCookies(),
  ],
})
```

`nextCookies()` is for Next.js only. Leave it out on any other framework.

Why each of the non-default lines is there:

| Setting | Why |
| --- | --- |
| `pkce: true` | better-auth's client defaults it to `false`, but vauth requires PKCE. Without it every sign-in fails at the token endpoint with an error that does not mention PKCE. This one line has already cost a full day |
| `requireIssuerValidation: true` | Rejects a token whose issuer is not the one discovery advertised |
| `mapProfileToUser` | `name` is optional in OIDC. If your `user.name` is `NOT NULL` and a profile arrives without one, the insert fails with `name_is_missing` *after* the OAuth handshake has succeeded, so the user lands back on your login page with no explanation. A relying party should never assume an optional claim is present |
| `emailAndPassword: { enabled: false }` | vauth is the only way in. A password here would be a second door into every account, and nobody would be watching it |
| `trustedProviders: ["voss"]` | Lets a vauth login link to an existing user with the same email. That is safe only because vauth genuinely verifies the mailbox. Never add a provider here that does not verify email: whoever registers `victim@vit.edu.in` there inherits the victim's account |
| `allowDifferentEmails: false` | The email is the whole reason the link is trusted. Never link across two different addresses |
| `session` | 7-day sessions that slide forward daily, so an active user is never logged out mid-task |

### If your product had users before vauth

If your database already has `user` rows from an older password login, the first
vauth sign-in fails with `account_not_linked`, even with `trustedProviders`
set. better-auth also refuses when the **existing local** account's email is
unverified (`requireLocalEmailVerified` defaults to `true`), and an old password
signup verified nothing.

You can fix it in one of two ways:

1. **Delete the legacy `user` and `account` rows.** If the product is pre-launch,
   this is the cleaner fix: no linking ever happens.
2. Set `requireLocalEmailVerified: false` under `accountLinking`. This is safe
   **only while `emailAndPassword` stays disabled**. A legacy row grants access
   to nobody, because the only way into any account is a vauth-verified mailbox.
   Turn passwords back on and this becomes an account takeover. VERP does this,
   and the comment in its `auth.ts` explains the attack in full.

## 4. Mount the handler

better-auth serves the callback and its own endpoints under `/api/auth/*`.

Next.js, `src/app/api/auth/[...all]/route.ts`:

```ts
import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"

export const dynamic = "force-dynamic"

export const { GET, POST } = toNextJsHandler(auth)
```

React Router, `app/routes/api.auth.$.ts`:

```ts
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router"
import { auth } from "~/lib/auth.server"

export function loader({ request }: LoaderFunctionArgs) {
  return auth.handler(request)
}

export function action({ request }: ActionFunctionArgs) {
  return auth.handler(request)
}
```

## 5. Client: sign in and sign out

```ts
import { createAuthClient } from "better-auth/react"
import { genericOAuthClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
})

export const { signIn, signOut, useSession } = authClient
```

Do not export `signUp`. Your product cannot create accounts; accounts are created
at vauth, which is the thing that verifies the college email.

The login page is one button. It has no email field, no password field, and no
sign-up toggle:

```ts
const { error } = await authClient.signIn.oauth2({
  providerId: "voss",
  callbackURL: "/dashboard",
})
if (error) setError(error.message ?? "Could not reach VOSS. Try again in a moment.")
```

`signOut()` ends **your product's** session. The person is still signed in at
vauth, so the next "Sign in with VOSS" goes through without a code. That is
single sign-on working as intended. vauth also publishes an
`end_session_endpoint` for full logout. Neither VERP nor vroom calls it today.

## 6. Protect routes

Redirect anyone without a session cookie before a page renders. VERP does it in
`src/proxy.ts` (Next 16's middleware):

```ts
import { NextRequest, NextResponse } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

const publicRoutes = ["/login", "/api/auth"]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  return NextResponse.next()
}
```

The cookie check decides only whether a request gets through. It does not decide
who the caller is. Every server action and API route resolves the user with
`auth.api.getSession({ headers })` and checks permissions itself.

## 7. Map the identity to your own records

vauth hands you a verified email. Your product decides which person in your own
data that email belongs to. Get this part wrong and you have an authorization
bug, however correct the login is. VERP's `src/lib/bind.ts` does it like this:

- **Bind on the verified email only.** Never bind on anything the user types,
  such as a roll number or a name. Otherwise any verified student could claim a
  classmate's record.
- **Bind on every sign-in, not only the first.** A student who signs in before
  their record exists gets linked the next time they sign in.
- **Never repoint a record.** If a record is already bound to a different vauth
  user, refuse and log it. Silently rebinding hands that account to whoever
  signed in second.
- **Never let a failed bind take login down.** The session already exists by the
  time the hook runs.

```ts
databaseHooks: {
  session: {
    create: {
      after: async (session) => {
        try {
          const u = await db.query.user.findFirst({
            where: (user, { eq }) => eq(user.id, session.userId),
            columns: { id: true, email: true },
          })
          if (u) await bindIdentity(u.id, u.email)
        } catch (error) {
          console.error("[bind] failed for session", session.userId, error)
        }
      },
    },
  },
},
```

**No match means no role.** It does not mean a default role. A verified
`@vit.edu.in` address that is in none of your records belongs to a real person
you know nothing about. Send them to an explicit dead end (VERP uses
`/unclaimed`), not into the app as a student.

**Guards are allowlists.** This is a hole:

```ts
if (!user || user.role === "student") return forbidden()
```

A user with no role gets straight through it, and in VERP that once included the
routes that write marks. Check for the roles that **are** allowed. A type
predicate such as `isStaff(user): user is Staff` makes the compiler refuse any
route that forgets to narrow.

## 8. On Cloudflare Workers

vroom's `app/lib/auth.server.ts` differs from VERP's in four ways:

- **Build better-auth lazily.** Module scope on Workers runs before any request
  exists, which is before secrets are injected. An instance built at import time
  gets `undefined` secrets in production, and `wrangler dev` hides this. vroom
  wraps it in a Proxy that builds on first use and caches the result per isolate:

  ```ts
  let instance: ReturnType<typeof build> | null = null

  export const auth = new Proxy({} as ReturnType<typeof build>, {
    get(_target, prop) {
      const target = (instance ??= build())
      const value = Reflect.get(target, prop)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  ```

- **Pass `baseURL` and `secret` explicitly** from `process.env` inside `build()`.
- **`transaction: false` on the drizzle adapter** when you use `neon-http`. It
  cannot open interactive transactions, and leaving them on silently breaks user
  creation.
- **Serve on the registered hostname.** The production redirect URI names a
  hostname, so the Worker needs a matching custom-domain route in
  `wrangler.jsonc`. Put non-secret values (`BETTER_AUTH_URL`,
  `VOSS_DISCOVERY_URL`) in `vars`, and set the client secret with
  `wrangler secret put`.

Keeping passwords off matters even more on Workers: scrypt does not fit inside
the free tier's CPU budget.

## 9. Local development

**If you hold the client credentials,** the localhost redirect URI is registered
against production vauth. Put the three `VOSS_*` values in your `.env`, run the
app, and sign in with your real college email.

**Most contributors will not have them,** and should not need them. A
contributor who cannot sign in cannot run your app. VERP solves this with a
local identity switcher (`docs/local-dev.md` in VERP): seeded people, and a
cookie that names which one you are. It is locked three ways:

- it refuses to run when `NODE_ENV` is `production`;
- it needs an explicit opt-in flag (`VERP_DEV_AUTH=1`);
- the build fails outright if both are present.

The switcher substitutes only the fields vauth would have supplied (id, name,
email, image). Roles and scopes are still resolved from the database, so the
permissions you test locally are the real ones. Copy that pattern instead of
giving contributors a shared client secret.

## 10. Verify

From the vauth repo, a maintainer can run the whole flow against the live server.
The script handles discovery, sign-in, authorize, the token exchange, and checks
the ID token against the published JWKS. It reads the sign-in code straight from
the database, so it needs the production `DATABASE_URL` in `.env`:

```sh
VERIFY_BASE_URL=https://accounts.vosslabs.org \
VERIFY_EMAIL=you@vit.edu.in \
VERIFY_CLIENT_ID=... VERIFY_CLIENT_SECRET=... \
npm run clients:verify
```

Then, in your product:

1. Sign in end to end and land on your `callbackURL`.
2. Check that the new `user` row has a `name`.
3. Sign out and sign in again. You should get the same user, not a duplicate.
4. Sign in as someone who is in none of your records. You should hit the dead
   end, not the app.

## When it breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| `INVALID_OAUTH_CONFIGURATION` | The `VOSS_*` env vars are not set where the app runs, so discovery never loaded | Set them in the deployed environment, not just your local `.env` |
| Sign-in fails at the token endpoint | `pkce` is not `true` | Set `pkce: true` |
| vauth rejects the redirect URI | Registered URI differs from the one sent: port, scheme, trailing slash, or `providerId` | Make them match exactly. A maintainer has to update an existing client |
| `name_is_missing` | No `mapProfileToUser`, with `user.name` `NOT NULL` | Add `mapProfileToUser` |
| `account_not_linked` | An existing user row with the same email; `trustedProviders` is missing, or the local email is unverified | See "If your product had users before vauth" |
| Token exchange rejects the client | Wrong secret, or the secret was rotated | Get the current secret from a maintainer |

`research/integration-issues.md` is the full account of how VERP's integration
broke, and why. Read it before you integrate anything unusual.
