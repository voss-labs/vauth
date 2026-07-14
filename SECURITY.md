# Security Policy

vauth is an identity provider. A vulnerability here can affect every account and
every product that trusts VOSS to authenticate users, so please report privately
rather than opening a public issue.

## Reporting

Email **security@vosslabs.org** (or, if that bounces, `admin@vosslabs.org`) with:

- what you found and where (file, endpoint, or a proof-of-concept)
- the impact you believe it has
- steps to reproduce

Do not open a public issue, and do not test against real accounts other than your
own. We will acknowledge within a few days and keep you updated.

## In scope

Authentication and session handling, the OAuth/OIDC provider, the admin console,
the recovery-email flow, the `@vit.edu.in` gate, rate limiting, and anything that
could let one user act as another.

## Good to know

- The service is passwordless (email OTP); there are no passwords to leak.
- Secrets live only in the deployment environment, never in the repo.
- The security-critical files are listed in `.github/CODEOWNERS`.
