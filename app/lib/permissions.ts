import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

export const ac = createAccessControl(defaultStatements);

// Three capabilities are withheld from EVERY role, including super_admin:
//
//   impersonate     — the console must never let an admin become a student
//   set-password    — no arbitrary credential setting (and we have no passwords)
//   delete          — accounts are disabled (banned), never destroyed; marks and
//                     audit trails must stay attributable
//
// These are not oversights. Granting any of them turns the identity console into
// a tool that can silently assume a student's identity or erase the evidence.

export const roles = {
  // Owns their own account and sessions. Nothing else.
  user: ac.newRole({
    user: [],
    session: [],
  }),

  // Day-to-day account support: find a user, inspect their status, disable a
  // compromised account, kill its sessions.
  identity_admin: ac.newRole({
    user: ["list", "get", "ban"],
    session: ["list", "revoke"],
  }),

  // Everything identity_admin can do, plus assigning central roles.
  super_admin: ac.newRole({
    user: ["list", "get", "ban", "set-role"],
    session: ["list", "revoke"],
  }),
};
