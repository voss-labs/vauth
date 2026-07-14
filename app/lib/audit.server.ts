import { randomUUID } from "node:crypto";
import * as schema from "~/db";

// The web-side audit writer. The CLI has its own in scripts/lib/admin.ts because
// it talks to the database directly rather than through Drizzle's schema binding.
export async function audit(
  db: any,
  entry: {
    action: string;
    actorId?: string | null;
    actorEmail?: string | null;
    targetType?: string;
    targetId?: string;
    details?: unknown;
    request?: Request;
  }
) {
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    action: entry.action,
    actorId: entry.actorId ?? null,
    actorEmail: entry.actorEmail ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? null,
    ipAddress: entry.request?.headers.get("cf-connecting-ip") ?? null,
    userAgent: entry.request?.headers.get("user-agent") ?? null,
  });
}
