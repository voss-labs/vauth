// Everything VIT-specific in voss-auth lives in this file. A fork for another
// college changes these lines and nothing else — roll-number format, branch
// codes and division rules are NOT here, because they belong to the product's
// student registry (VERP), not to the identity provider.

export const ALLOWED_EMAIL_DOMAIN = "vit.edu.in";

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
