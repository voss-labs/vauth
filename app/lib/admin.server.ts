import { redirect } from "react-router";
import { desc, eq, ilike, or, sql as raw } from "drizzle-orm";
import { createHash } from "@better-auth/utils/hash";
import { base64Url } from "@better-auth/utils/base64";

import { auth, getDb } from "~/lib/auth.server";
import * as schema from "~/db";
import { ADMIN_ROLES, ROLES, type Role } from "~/lib/config";

export type AdminActor = {
  id: string;
  email: string;
  role: Role;
  isSuperAdmin: boolean;
};

/**
 * Every admin loader and action starts here. The guard is server-side and
 * re-checked on each request — hiding a button is a UI convenience, never a
 * permission.
 */
export async function requireAdmin(request: Request): Promise<AdminActor> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/sign-in");

  const role = (session.user.role ?? ROLES.USER) as Role;
  if (!ADMIN_ROLES.includes(role)) throw redirect("/account");

  return {
    id: session.user.id,
    email: session.user.email,
    role,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
  };
}

/** Assigning central roles is super-admin only. The brief is explicit. */
export function requireSuperAdmin(actor: AdminActor) {
  if (!actor.isSuperAdmin) {
    throw new Response("Only a super-admin may assign central roles.", {
      status: 403,
    });
  }
}

export async function searchUsers(query: string) {
  const db = getDb();
  const q = query.trim();

  const rows = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.user.role,
      emailVerified: schema.user.emailVerified,
      banned: schema.user.banned,
      recoveryEmail: schema.user.recoveryEmail,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(
      q
        ? or(
            ilike(schema.user.email, `%${q}%`),
            ilike(schema.user.name, `%${q}%`)
          )
        : undefined
    )
    .orderBy(desc(schema.user.createdAt))
    .limit(50);

  return rows;
}

export async function getUserDetail(userId: string) {
  const db = getDb();

  const [users, sessions, events] = await Promise.all([
    db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1),
    db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
      .orderBy(desc(schema.session.createdAt)),
    db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, userId))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(20),
  ]);

  if (!users.length) throw new Response("No such user", { status: 404 });
  return { user: users[0], sessions, events };
}

export async function listAuditLog(limit = 100) {
  const db = getDb();
  return db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);
}

export async function listClients() {
  const db = getDb();
  return db
    .select()
    .from(schema.oauthClient)
    .orderBy(desc(schema.oauthClient.createdAt));
}

// SAME hash better-auth applies to a client secret at rest (SHA-256 / base64url,
// unpadded). Rotation MUST reproduce it exactly or the token endpoint rejects the
// client. Kept identical to scripts/lib/admin.ts — the CLI and console rotate the
// same way.
async function hashClientSecret(secret: string): Promise<string> {
  const digest = await createHash("SHA-256").digest(
    new TextEncoder().encode(secret),
  );
  return base64Url.encode(new Uint8Array(digest), { padding: false });
}

function generateClientSecret(): string {
  // Web Crypto — native on Cloudflare Workers and Node alike, no nodejs_compat.
  return base64Url.encode(crypto.getRandomValues(new Uint8Array(32)), {
    padding: false,
  });
}

/** Revoke (or restore) a client's ability to start a login. Never deletes it. */
export async function setClientDisabled(clientId: string, disabled: boolean) {
  const db = getDb();
  const [row] = await db
    .update(schema.oauthClient)
    .set({ disabled, updatedAt: new Date() })
    .where(eq(schema.oauthClient.clientId, clientId))
    .returning({
      clientId: schema.oauthClient.clientId,
      name: schema.oauthClient.name,
    });
  return row ?? null;
}

/**
 * Issue a fresh secret for a client and store only its hash. Returns the new
 * plaintext ONCE so it can be shown to paste into the product — it is never
 * recoverable afterward. The old secret stops working immediately.
 */
export async function rotateClientSecret(clientId: string) {
  const db = getDb();
  const secret = generateClientSecret();
  const stored = await hashClientSecret(secret);
  const [row] = await db
    .update(schema.oauthClient)
    .set({ clientSecret: stored, updatedAt: new Date() })
    .where(eq(schema.oauthClient.clientId, clientId))
    .returning({
      clientId: schema.oauthClient.clientId,
      name: schema.oauthClient.name,
    });
  if (!row) return null;
  return { clientId: row.clientId, name: row.name, secret };
}

export async function countStats() {
  const db = getDb();
  const [users, admins, clients, sessions] = await Promise.all([
    db.select({ n: raw<number>`count(*)::int` }).from(schema.user),
    db
      .select({ n: raw<number>`count(*)::int` })
      .from(schema.user)
      .where(eq(schema.user.role, ROLES.SUPER_ADMIN)),
    db.select({ n: raw<number>`count(*)::int` }).from(schema.oauthClient),
    db.select({ n: raw<number>`count(*)::int` }).from(schema.session),
  ]);
  return {
    users: users[0].n,
    superAdmins: admins[0].n,
    clients: clients[0].n,
    sessions: sessions[0].n,
  };
}
