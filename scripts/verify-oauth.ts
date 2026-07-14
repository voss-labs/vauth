import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import pc from "picocolors";

import { banner, voss } from "./lib/brand";
import { sql } from "./lib/admin";

// Drives the entire OAuth 2.1 + OIDC flow the way VERP will, against a live
// server. Nothing here trusts our own code: it asks the provider for its
// discovery document, follows the redirects it issues, and verifies the ID token
// against the published JWKS.
//
// Two things this exists to catch, and neither shows up in a unit test:
//   1. Whether the client secret we hashed into the database actually verifies
//      at the token endpoint (we replicate better-auth's hasher — this proves it).
//   2. better-auth's open bug: "Authorize does not always resume after a fresh
//      sign-in". That is the path EVERY user takes exactly once.

const BASE = process.env.VERIFY_BASE_URL ?? process.env.BETTER_AUTH_URL!;
const EMAIL = process.env.VERIFY_EMAIL ?? "harshal.more@vit.edu.in";

const ok = (m: string) => console.log(`  ${pc.green("ok")}      ${m}`);
const fail = (m: string) => console.log(`  ${pc.red("FAIL")}    ${m}`);
const info = (m: string) => console.log(`  ${pc.dim("·")}       ${pc.dim(m)}`);

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function main() {
  console.log(banner(`OAuth flow verification  ${pc.dim(BASE)}`));

  // 1. Discovery
  const disc = await fetch(
    `${BASE}/api/auth/.well-known/openid-configuration`,
  ).then((r) => r.json() as any);
  if (!disc.issuer) return fail("discovery document unreachable");
  ok(`discovery — issuer ${pc.bold(disc.issuer)}`);
  info(
    `PKCE: ${disc.code_challenge_methods_supported?.join(",")}  grants: ${disc.grant_types_supported?.join(",")}`,
  );

  // 2. The registered client
  const rows = (await sql()`
    SELECT client_id, name, redirect_uris, skip_consent, require_pkce
    FROM oauth_client WHERE client_id = ${process.env.VERIFY_CLIENT_ID} LIMIT 1
  `) as any[];
  if (!rows.length)
    return fail("no OAuth client registered — run `npm run clients`");
  const client = rows[0];
  ok(`client — ${pc.bold(client.name)} (${client.client_id})`);

  const secret = process.env.VERIFY_CLIENT_SECRET;
  if (!secret) {
    fail("VERIFY_CLIENT_SECRET is not set");
    info(
      "The secret is hashed at rest and cannot be read back. Pass the plaintext",
    );
    info(
      "that `npm run clients` printed:  VERIFY_CLIENT_SECRET=… npm run clients:verify",
    );
    process.exit(1);
  }

  // 3. Sign in — a real session, exactly as a student would have
  await fetch(`${BASE}/api/auth/email-otp/send-verification-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, type: "sign-in" }),
  });
  const otpRow = (await sql()`
    SELECT value FROM verification
    WHERE identifier = ${"sign-in-otp-" + EMAIL}
    ORDER BY created_at DESC LIMIT 1
  `) as any[];
  const otp = String(otpRow[0]?.value ?? "").split(":")[0];
  if (!otp) return fail("no OTP was issued");

  const signIn = await fetch(`${BASE}/api/auth/sign-in/email-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, otp }),
  });
  const cookie = (signIn.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!signIn.ok || !cookie) return fail(`sign-in failed (${signIn.status})`);
  ok(`signed in as ${EMAIL}`);

  // 4. Authorize, with PKCE
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const redirectUri = client.redirect_uris[0];

  const authorizeUrl = new URL(disc.authorization_endpoint);
  authorizeUrl.search = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const authRes = await fetch(authorizeUrl, {
    headers: { cookie },
    redirect: "manual",
  });

  // better-auth 302s a browser but returns {redirect, url} to an API-style
  // caller. A relying party must handle whichever it gets, so we do too.
  let location = authRes.headers.get("location");
  if (!location) {
    const body = await authRes.clone().text();
    try {
      const parsed = JSON.parse(body);
      if (parsed?.redirect && typeof parsed.url === "string") location = parsed.url;
    } catch {
      /* not JSON */
    }
  }
  if (!location) {
    fail(`authorize neither redirected nor returned a redirect URL (${authRes.status})`);
    info((await authRes.text()).slice(0, 200));
    process.exit(1);
  }

  const redirected = new URL(location, BASE);
  if (!redirected.searchParams.get("code")) {
    fail(
      `authorize redirected to ${redirected.pathname} instead of the client`,
    );
    info("This is the known bug: authorize did not resume after sign-in.");
    info(`location: ${location.slice(0, 160)}`);
    process.exit(1);
  }
  const code = redirected.searchParams.get("code")!;
  ok(`authorize — code issued, consent skipped (first-party)`);

  if (redirected.searchParams.get("state") !== state) {
    return fail("state did not round-trip — replay protection is broken");
  }
  ok("state round-tripped");

  // 5. Token exchange — this is what proves the client-secret hash is right
  const tokenRes = await fetch(disc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      client_secret: secret,
      code_verifier: verifier,
    }),
  });
  const tokens = (await tokenRes.json()) as any;
  if (!tokenRes.ok || !tokens.id_token) {
    fail(`token exchange failed (${tokenRes.status})`);
    info(JSON.stringify(tokens).slice(0, 240));
    process.exit(1);
  }
  ok("token exchange — client secret verified, PKCE verified");

  // 6. The ID token, checked against the published JWKS
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  const jwks = createRemoteJWKSet(new URL(disc.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: disc.issuer,
    audience: client.client_id,
  });

  if (payload.nonce !== nonce)
    return fail("nonce did not match — replay protection is broken");
  ok("ID token — signature, issuer, audience and nonce all verify");

  console.log();
  console.log(`  ${pc.dim("sub")}     ${pc.bold(String(payload.sub))}`);
  console.log(`  ${pc.dim("email")}   ${payload.email}`);
  console.log();
  console.log(
    `  ${pc.green("The subject above is what a product stores as its external identity")}`,
  );
  console.log(
    `  ${pc.green("reference. It never changes, and it is all the product gets.")}`,
  );
  console.log();
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
