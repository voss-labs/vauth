// Everything VIT-specific in voss-auth lives in this file. A fork for another
// college changes these lines and nothing else — roll-number format, branch
// codes and division rules are NOT here, because they belong to the product's
// student registry (VERP), not to the identity provider.

// Who may sign in: VIT students/faculty, plus the VOSS Labs team who run the
// products. A fork for another college edits this list and nothing else.
export const ALLOWED_EMAIL_DOMAINS = ["vit.edu.in", "vosslabs.org"] as const;

// For error messages and placeholders, e.g. "@vit.edu.in or @vosslabs.org".
export const ALLOWED_EMAIL_DOMAINS_LABEL = ALLOWED_EMAIL_DOMAINS.map(
  (d) => `@${d}`
).join(" or ");

/**
 * Where vauth is publicly served. This is NOT the same as BETTER_AUTH_URL.
 *
 * BETTER_AUTH_URL is the *runtime* origin, and on a laptop it is localhost. The
 * admin CLIs run on a laptop while writing to the *production* database, so
 * deriving a relying party's discovery URL from BETTER_AUTH_URL handed VERP
 * `http://localhost:5173/...` — a client registered in production, pointed at a
 * server that only exists on one machine.
 *
 * Anything a relying party has to be told comes from here.
 */
export const PUBLIC_ORIGIN =
  process.env.PUBLIC_ORIGIN ?? "https://accounts.vosslabs.org";

export const DISCOVERY_URL = `${PUBLIC_ORIGIN}/api/auth/.well-known/openid-configuration`;

export function isInstitutionalEmail(email: string): boolean {
  // Exact-domain, not suffix. `endsWith("@vit.edu.in")` accepts
  // `attacker@evil.com@vit.edu.in` — two @ signs, an address that does not route
  // to the college. Split, require exactly one @, compare the domain outright.
  const parts = email.trim().toLowerCase().split("@");
  return (
    parts.length === 2 &&
    (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(parts[1])
  );
}

/**
 * vauth must never mint a nameless identity. `name` is the whole content of
 * OIDC's `profile` scope, and a relying party that stores it NOT NULL — VERP
 * does — rejects the login outright with `name_is_missing`, after the OAuth
 * dance has already succeeded. The user is left staring at a login page with no
 * idea why.
 *
 * Signing in with an OTP never asks for a name, so we derive a decent one and
 * let the account page correct it.
 */
export function deriveName(email: string): string {
  const local = email.split("@")[0] ?? "";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || email
  );
}

// Central IDENTITY roles. These say what you may do to *accounts* — they grant
// nothing inside VERP or vboard. Product roles (student, faculty, TR, hod) live
// in each product's own database and are never mirrored here.
export const ROLES = {
  USER: "user",
  IDENTITY_ADMIN: "identity_admin",
  SUPER_ADMIN: "super_admin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ADMIN_ROLES: Role[] = [ROLES.IDENTITY_ADMIN, ROLES.SUPER_ADMIN];

// Higher rank = more power. An admin may only act on accounts ranked strictly
// below their own — otherwise a support-tier identity_admin could disable the
// super_admin and decapitate the root of trust.
const ROLE_RANK: Record<string, number> = {
  user: 0,
  identity_admin: 1,
  super_admin: 2,
};

export function roleRank(role: string | null | undefined): number {
  return ROLE_RANK[role ?? "user"] ?? 0;
}

/** Can `actor` take a disable/revoke action against `target`? */
export function outranks(
  actor: string | null | undefined,
  target: string | null | undefined,
): boolean {
  return roleRank(actor) > roleRank(target);
}
