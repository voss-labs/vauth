// Everything VIT-specific in voss-auth lives in this file. A fork for another
// college changes these lines and nothing else — roll-number format, branch
// codes and division rules are NOT here, because they belong to the product's
// student registry (VERP), not to the identity provider.

export const ALLOWED_EMAIL_DOMAIN = "vit.edu.in";

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
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
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
