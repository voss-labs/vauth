# Everything that broke, and why

Written 2026-07-14, the day VERP first authenticated through vauth.

Every item here cost real time. vboard has to do all of this again, and a fork
for another college will hit most of it. Read this before integrating, not after.

The pattern worth noticing: **almost nothing failed loudly.** The OAuth protocol
itself worked on the first real attempt. What broke was everything around it —
and most of it broke silently, or with an error that pointed at the wrong thing.

---

## Part 1 — Building the provider (Cloudflare Workers)

### Secrets do not exist at module scope

```ts
const db = drizzle(neon(process.env.DATABASE_URL!))   // undefined. always.
```

Module scope runs at isolate boot, **before any request exists**, so secrets are
not injected yet. Production threw *"No database connection string was provided
to `neon()`"* no matter how correctly the secret was set.

`wrangler dev` hides this completely — it populates `process.env` from
`.dev.vars` at startup. The real runtime does not. So it works on your laptop and
dies in production, which is the worst possible failure shape.

**Fix:** build `db` and `auth` lazily, on first access, cached. See the Proxy in
`app/lib/auth.server.ts`.

### `wrangler deploy` silently deploys stale config

The Cloudflare Vite plugin bakes `wrangler.jsonc` into `build/server/`. Running
`wrangler deploy` without rebuilding deploys **the previous config** — with no
warning. We spent a while wondering why `BETTER_AUTH_URL` still said `localhost`
and the custom domain never appeared.

**Fix:** always `npm run deploy` (which is `build && wrangler deploy`).

### The asset layer eats form POSTs

Without `assets.run_worker_first`, Cloudflare's static-asset layer answers first
and returns **405 to every non-GET request** whose path collides with an asset
route. Every form POST in the app breaks. Nothing appears in the Worker log,
because the Worker is never invoked.

```jsonc
"assets": { "run_worker_first": ["/*", "!/assets/*"] }
```

### An action on the index route never runs

`POST /` returned 405 and never reached React Router at all, while `POST /sign-in`
reached it correctly. Moving the page to `/account` fixed it. `/` is now purely a
router: signed in → `/account`, signed out → `/sign-in`.

### A `.server` import in a component fails the build — and the build failure is easy to miss

`account.tsx` called a formatting helper from `~/lib/account.server` inside the
JSX. React Router strips server code from `loader`/`action` **only**, so that
dragged the database driver into the client bundle and the build failed.

Because `npm run deploy` is `build && deploy`, nothing deployed — and we kept
"verifying" fixes against stale code for several rounds, because the deploy output
was being filtered.

**Do not filter build/deploy output.** That is how a red build looks green.

### Real CPU is 5–20× your laptop

Local `wrangler dev` measured `auth.handler` at **1.4ms median**. A real
Cloudflare core measured **12ms median, 49ms peak** on the SSR route.

The documented free-tier cap is **10ms CPU/request**. Had we trusted the local
number, we would have discovered this in October with a department depending on it.

**Measure on the edge. `wrangler tail --format json` reports `cpuTime`.**

---

## Part 2 — better-auth, the provider side

### The plugin named "OIDC" is the wrong one

`oidcProvider` is **deprecated**. Its own docs say *"may not be suitable for
production use"* and its JWKS endpoint is *"not fully implemented"*. The one you
want is `@better-auth/oauth-provider` — which despite the name **is** an OpenID
Connect provider.

Migrating off `oidcProvider` later is brutal: the tables are not column-compatible
and the `ALTER` aborts on a populated table. Start on the right one.

### Discovery lives outside the auth catch-all

The issuer is path-prefixed (`https://host/api/auth`), so OIDC discovery is at
`{issuer}/.well-known/openid-configuration` — served by the auth splat. But
**RFC 8414** metadata sits at the origin root
(`/.well-known/oauth-authorization-server/api/auth`), *outside* it, and 404s
unless you mount a separate route. See `app/routes/well-known.ts`.

better-auth then warns about this on **every discovery request** even when the
route exists, because it cannot see routes outside its own handler. Silence it
with `silenceWarnings: { oauthAuthServerConfig: true }` — but only after checking
the route really does return 200.

### better-auth swallows every email failure

`runInBackgroundOrAwait` catches and logs on **both** of its branches, so a dead
email provider returns `{"success": true}` while nothing sends. Under passwordless
that is not a papercut — it is a **silent, permanent lockout**: no mail, no error,
and no password to fall back on.

**Fix:** do **not** wire `advanced.backgroundTasks`. Its absence is what makes
better-auth `await` the send, which is the only way to catch the failure before
the response is written. Then surface it as a real error. It costs no CPU — the
send is I/O.

### No client IP means one shared rate-limit bucket

better-auth defaults to reading `x-forwarded-for`, which Cloudflare does not
populate. With no resolvable IP it warns that rate limiting *"falls back to a
single shared per-path bucket"* — so **one attacker spamming OTP requests exhausts
the allowance the entire college shares.** On a passwordless system, OTP spam is
the primary abuse vector.

```ts
advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }
```

`cf-connecting-ip` is the only header worth trusting: Cloudflare overwrites it on
every request, so a client cannot forge it. Trusting `x-forwarded-for` would let
anyone mint a fresh bucket per request.

### `SERVER_ONLY` does not mean "skips auth"

`adminCreateOAuthClient` is marked `SERVER_ONLY` — unreachable over HTTP — but it
**still requires an authenticated admin session**, which a CLI does not have. That
surfaces a bootstrap problem: you cannot register a client without a super-admin,
and no super-admin exists.

We write the `oauth_client` row directly instead, using better-auth's own hasher
(SHA-256 → base64url, unpadded, from `@better-auth/utils`). `npm run
clients:verify` completes a real token exchange to prove that hash still matches
rather than assuming it.

### A nameless identity breaks relying parties

Signing in with an OTP never asks for a name, so `user.name` was `""`. `name` is
the whole content of the OIDC `profile` scope, and a relying party that stores it
`NOT NULL` — VERP does — **rejects the login after the OAuth dance has already
succeeded.**

Provider side: never mint a nameless identity. Client side: never assume an
optional claim arrives. Both.

### The CLI runs on a laptop but writes to production

`BETTER_AUTH_URL` is the *runtime* origin — legitimately `localhost` in dev. The
admin CLIs run locally while writing to the **production** database, so deriving a
relying party's discovery URL from it handed VERP `http://localhost:5173/...` for
a client registered in production.

**The public issuer is a deployment constant** (`PUBLIC_ORIGIN` in `config.ts`),
not a runtime one.

---

## Part 3 — Integrating a client (VERP)

The errors arrived in a chain. Each fix revealed the next one. In order:

### `INVALID_OAUTH_CONFIGURATION`

The env vars were not set. Discovery never fetched, so `authorization_endpoint`
was empty. Check `VOSS_DISCOVERY_URL`, `VOSS_CLIENT_ID`, `VOSS_CLIENT_SECRET` —
and remember a local `.env` is **never deployed**; a hosted app needs them in its
own environment settings.

### `pkce: true` — the one-line day-burner

`genericOAuth` defaults `pkce` to **false**. The provider **requires** PKCE
(OAuth 2.1). They do not meet in the middle, so without this every sign-in fails
at the token endpoint with an unhelpful error.

### `name_is_missing`

Covered above. `name` is **optional** in OIDC; VERP stored it `NOT NULL`. Fixed on
both sides — but the client-side fix (`mapProfileToUser`) is the one that matters,
because a relying party cannot control what a provider sends it.

### `account_not_linked`, part 1 of 2

VERP already had a `user` row for that email (from the old password setup), and
better-auth **refuses to auto-link** an OAuth identity to an existing account.

That refusal is the **correct default**. Auto-linking by email to a provider that
does not genuinely verify the address is an account takeover: an attacker registers
`victim@vit.edu.in` at some sloppy provider and inherits the victim's account.

VOSS does verify — an OTP to the real mailbox *is* the login — which is exactly
what `trustedProviders: ["voss"]` is for. Add nothing else to that list without
checking it verifies email.

### `account_not_linked`, part 2 of 2 — the subtle one

**`trustedProviders` alone was not enough.** From
`better-auth/dist/oauth2/link-account.mjs`:

```js
const requireLocalEmailVerified = accountLinking?.requireLocalEmailVerified ?? true;
if (!isTrustedProvider && !userInfo.emailVerified
    || requireLocalEmailVerified && !dbUser.user.emailVerified   // ← fires here
    || accountLinking?.enabled === false) { refuse }
```

The refusal fires on the **local** account's unverified email too — and it defaults
to `true`. Every legacy VERP row is unverified, because the old password signup
verified nothing. So the link was refused on *our* side, however trusted VOSS was.

`requireLocalEmailVerified: false` unblocks it, and is safe **only because
passwords are disabled**: a legacy row confers access to nobody, since the only way
into any account is now a VOSS-verified mailbox. **Re-enable `emailAndPassword` and
this becomes an account takeover.**

The cleaner fix, if the product is pre-launch: **delete the legacy `user` and
`account` rows.** Then no linking is ever needed.

### Fixing the fail-open opened a second fail-open

`session.ts` defaulted `role` to `"student"`, so an account with no roster match
silently received a student's access. Making `role` nullable is obviously right.

But four guards were **denylists**:

```ts
if (!user || user.role === "student") return 403   // a roleless user is NOT a student
```

A roleless user sails straight through — **including into the routes that write
marks.** Fixing one hole would have opened another.

All four are now allowlists behind `isStaff()`, which is a **type predicate**, so
the compiler refuses to build a route that forgets to narrow. Make the mistake
impossible, not merely fixed.

### better-auth returns a JSON redirect envelope, not always a 302

`/oauth2/authorize` 302s a browser but returns `{redirect: true, url: "..."}` to an
API-style caller. Anything driving the flow programmatically must handle both.

---

## Part 4 — Process failures, ours

Worth recording, because they cost as much as the bugs.

**A squash merge shipped a stale head.** The last two commits on the PR — both
essential — never reached `main`, so the merged code still failed at the exact bug
they fixed. `gh pr merge` right after a push can race GitHub's view of the branch.
**Verify the merge commit contains what you think it does.**

**CI was already red on `main`.** `format:check` fails on drizzle-generated
migration metadata. The fix is a `.prettierignore` — reformatting generated files
just means the next `db:generate` dirties the tree again.

**Appending to `.env` without a trailing newline corrupted the API key.** `printf
'X=1\n' >> .env` concatenated onto the last line. The key silently became 74
characters.

**Filtering deploy output hid a red build** for several rounds of "verifying" a fix
that was never deployed.

---

## The shortest possible checklist for vboard

1. `pkce: true` on the client. It defaults to false.
2. `mapProfileToUser` — derive a name; `name` is optional in OIDC.
3. `trustedProviders: ["voss"]` **and** `requireLocalEmailVerified: false` if the
   product has legacy unverified rows — or just delete them.
4. Register the redirect URI in `clients.config.ts`. It is the security boundary;
   an exact match, no wildcards.
5. Guards must be **allowlists**. A roleless user is not a student.
6. Never store a roll number in the identity provider. It cannot verify one.
