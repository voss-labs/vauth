# Contributing to vauth

vauth is the identity provider for VOSS products. Because it authenticates real
students, some parts carry more weight than others. Contributions are genuinely
welcome — this guide is about *where* changes are easy and where they need care.

## Setup

Node **>= 22.22.0** (see `.nvmrc`).

```sh
nvm use
cp .env.example .env    # fill in, then: cp .env .dev.vars
npm install
npm run db:migrate
npm run dev
```

Without `RESEND_API_KEY`, OTP codes print to the console instead of being emailed.

GitHub sign-in is optional in dev. Without `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, the provider is not advertised and the primary @vit.edu.in OTP flow is unaffected. To exercise linking locally, register a GitHub OAuth App with callback URL `http://localhost:5173/api/auth/callback/github` and scopes `read:user`, `user:email`.

## Before you open a PR

```sh
npm run typecheck
```

Keep the style of the file you are editing. No semicolons debate — Prettier
decides, and CI checks it.

## What is easy to contribute

UI and copy, the account and console pages, the email templates, accessibility,
docs, and tests. Dive in.

## What needs a maintainer's review

The files in `.github/CODEOWNERS` — the auth config, the domain gate, the
permission model, the recovery flow, OAuth client registration, the schema, and
the deployment config. A change here that looks harmless can open every account,
so these need a second set of eyes that knows the threat model. Open a draft PR
early and ask; we would much rather discuss it before you build it.

Three rules that are load-bearing, and that a well-meaning PR could quietly break:

1. **No passwords.** `emailAndPassword` stays disabled. It is what keeps the
   Workers CPU budget and the account-linking model sound.
2. **The `user` table holds no product data** — no roll numbers, no marks. Those
   live in the product's own database.
3. **Redirect URIs are exact.** No wildcards, ever.

## Reporting a vulnerability

See `SECURITY.md`. Please do not open a public issue for security bugs.
