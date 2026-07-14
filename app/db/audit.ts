import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Hand-written, and deliberately NOT in schema.ts — `@better-auth/cli generate`
// overwrites that file wholesale, and would erase this on the next run.
//
// actorId has no foreign key to user.id on purpose. An audit trail whose rows
// vanish when the account is removed is not an audit trail. actorEmail is
// denormalised for the same reason: the record must still name a human after
// the account it points at is gone.
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),

    // Dotted, past-tense, and matched to VERP's convention so both products read
    // the same way: user.role_changed, client.registered, session.revoked.
    action: text("action").notNull(),

    actorId: text("actor_id"),
    actorEmail: text("actor_email"),

    targetType: text("target_type"),
    targetId: text("target_id"),

    details: jsonb("details"),

    // "cli" for privileged local commands, which have no HTTP request behind them.
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_action_idx").on(table.action),
    index("audit_log_actor_idx").on(table.actorId),
    index("audit_log_created_at_idx").on(table.createdAt),
  ]
);
