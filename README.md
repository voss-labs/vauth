# vauth

Central identity provider for VOSS products. A student creates one VOSS account and uses it to sign in to VERP and vboard. Each product keeps its own data, roles, permissions, and sessions.

vauth does not authenticate vask. Its SSH-fingerprint identity and anonymity model stay independent.

## Status

Early. The authentication flow works end to end — OTP, session, JWKS, OIDC discovery. There is no UI yet, no audit log, and no registered client.

## What this is

An **OpenID Connect provider**, built on OAuth 2.1.

The distinction matters. Bare OAuth answers "may this app access this resource" — authorization. OIDC answers "who is this person" — authentication. VERP needs the second: it has to learn the subject (`sub`) so it can bind a login to a student record. An access token alone would not tell it who signed in.

Better Auth calls the plugin `@better-auth/oauth-provider`, but it speaks OIDC: the `openid` scope, ID tokens, a `/oauth2/userinfo` endpoint, a JWKS, and a discovery document.

The issuer is **path-prefixed**, so discovery lives under the base path, not at the origin root:

```
https://accounts.vosslabs.org/api/auth/.well-known/openid-configuration
```

That is the `discoveryUrl` a relying party configures. `/.well-known/oauth-authorization-server/api/auth` (RFC 8414) is also served, from a route outside the auth catch-all.

PKCE `S256` is mandatory. There is no implicit grant and no password grant.

## Stack

React Router 8 (framework mode, SSR) on Cloudflare Workers, Better Auth + `@better-auth/oauth-provider`, Drizzle, Neon Postgres, Resend, shadcn/ui.

```
accounts.vosslabs.org
  /api/auth/*        Better Auth, OAuth 2.1 + OIDC endpoints, discovery
  /.well-known/*     RFC 8414 authorization-server metadata
  /*                 the React application
```

## Design rules

These are load-bearing. Breaking one either takes the service down or quietly widens the blast radius.

**No passwords.** The verified `@vit.edu.in` mailbox is the credential. A password would be a second, weaker secret guarding the same door — and scrypt does not fit the Cloudflare Workers free-tier CPU budget. Enabling `emailAndPassword` breaks the deployment.

**The `user` table never grows product columns.** No roll number, no year, no division, no department. Those describe a *student record*, and they belong to the product's registry (VERP). vauth answers "who are you", not "what is your academic state". This is also what keeps a product's migration onto vauth a config change rather than a data migration.

**Central roles are identity roles only** — `user`, `identity_admin`, `super_admin`. They grant nothing inside VERP or vboard. Product roles (student, faculty, TR, hod) live in each product's own database.

**Impersonation, password-setting, and hard-delete are withheld from every role, including `super_admin`.** See `app/lib/permissions.ts`.

**Email is a single point of failure.** Passwordless means no mail, no login. The OTP send is awaited inside the request so a failure surfaces as a real error rather than a silent lockout — do not wire `advanced.backgroundTasks`, or Better Auth will swallow it again.

**@vit.edu.in is the affiliation gate, not the credential.** A student signs in with the college mailbox to prove current affiliation; a linked GitHub account on `/account` then pins a durable identity that survives the day VIT revokes the mailbox. `socialProviders.github.disableSignUp: true` enforces the direction of travel: GitHub can sign in an existing user but cannot create a new one, so the college-email gate is never bypassed. GitHub OAuth is federated identity, not a stored secret, so the "no passwords" rule above still holds; scrypt still stays out of the request path. Recovery email remains as the orthogonal escape hatch when a linked GitHub is itself lost.

## Local development

Node **>= 22.22.0** — React Router 8 requires it, and `engine-strict` makes an
older version a hard failure at install rather than a warning you scroll past.

```sh
nvm use                   # reads .nvmrc
cp .env.example .env      # fill in, then: cp .env .dev.vars
npm install
npm run db:migrate
npm run dev
```

Without `RESEND_API_KEY`, OTP codes are logged to the console instead of emailed.

## Administration

```sh
npm run manage            # everything below, behind one menu
```

Privileged operations are CLI-only by design — registering an OAuth client or
granting `super_admin` requires database credentials, and is never reachable
over HTTP.

```sh
npm run bootstrap         # promote the first super_admin (one time)
npm run clients           # register the products in clients.config.ts
npm run clients:add       # wizard for a new product
npm run clients:verify    # drive the whole OAuth flow against a live server
```

Users manage their own account — recovery email, active sessions — at
`/account`. An admin can never set someone else's recovery address: that would
be a silent account takeover.

## Forking for another college

One constant: `ALLOWED_EMAIL_DOMAIN` in `app/lib/config.ts`. Roll-number formats, branch codes, and division rules are deliberately *not* here — they belong to the product's student registry, not to identity.

## Licence

MIT
