import { randomUUID, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createHash } from "@better-auth/utils/hash";
import { base64Url } from "@better-auth/utils/base64";

export type DbUser = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  email_verified: boolean;
  recovery_email: string | null;
  created_at: Date;
};

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Check your .env.");
  return neon(url);
}

export async function listUsers(): Promise<DbUser[]> {
  return (await sql()`
    SELECT id, email, name, role, email_verified, recovery_email, created_at
    FROM "user" ORDER BY created_at
  `) as DbUser[];
}

export async function findSuperAdmins(): Promise<DbUser[]> {
  return (await sql()`
    SELECT id, email, name, role, email_verified, recovery_email, created_at
    FROM "user" WHERE role = 'super_admin' ORDER BY created_at
  `) as DbUser[];
}

/**
 * Byte-for-byte the same hash the OAuth provider uses at rest, using the same
 * @better-auth/utils primitives — SHA-256, base64url, unpadded. Verified against
 * `defaultHasher` in @better-auth/oauth-provider.
 *
 * This is a real coupling: if better-auth changes its default hasher, a secret
 * minted here stops verifying at the token endpoint. better-auth is pinned, and
 * `npm run clients:verify` completes an actual token exchange to prove the hash
 * still matches rather than assuming it does.
 */
export async function hashClientSecret(secret: string): Promise<string> {
  const digest = await createHash("SHA-256").digest(
    new TextEncoder().encode(secret),
  );
  return base64Url.encode(new Uint8Array(digest), { padding: false });
}

export function generateClientSecret() {
  return base64Url.encode(new Uint8Array(randomBytes(32)), { padding: false });
}

export function generateClientId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}_${randomBytes(8).toString("hex")}`;
}

export async function audit(entry: {
  action: string;
  actorId?: string | null;
  actorEmail?: string | null;
  targetType?: string;
  targetId?: string;
  details?: unknown;
}) {
  await sql()`
    INSERT INTO audit_log (id, action, actor_id, actor_email, target_type, target_id, details, ip_address)
    VALUES (
      ${randomUUID()},
      ${entry.action},
      ${entry.actorId ?? null},
      ${entry.actorEmail ?? null},
      ${entry.targetType ?? null},
      ${entry.targetId ?? null},
      ${entry.details ? JSON.stringify(entry.details) : null},
      'cli'
    )
  `;
}
