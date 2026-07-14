import "dotenv/config";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import pc from "picocolors";

import {
  audit,
  findSuperAdmins,
  listUsers,
  sql,
  type DbUser,
} from "./lib/admin";
import { accent, banner, voss } from "./lib/brand";

const FORCE = process.argv.includes("--force");

function die(message: string): never {
  cancel(message);
  process.exit(1);
}

function abortIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) die("Cancelled. Nothing was changed.");
  return value as T;
}

async function promote(user: DbUser, reason: string) {
  // By immutable user ID, never by email. An email can be reassigned by the
  // college; the ID cannot. Promoting "whoever holds this address today" is how
  // an identity system hands root to the wrong person.
  await sql()`UPDATE "user" SET role = 'super_admin' WHERE id = ${user.id}`;

  await audit({
    action: "user.role_changed",
    actorEmail: "cli",
    targetType: "user",
    targetId: user.id,
    details: {
      from: user.role ?? "user",
      to: "super_admin",
      email: user.email,
      reason,
      forced: FORCE,
    },
  });
}

async function main() {
  console.log(banner("super-admin bootstrap"));
  intro(`${voss()}  ${pc.dim("vauth")}`);

  if (!process.env.DATABASE_URL)
    die("DATABASE_URL is not set. Check your .env.");

  const s = spinner();
  s.start("Reading identity database");
  const [users, admins] = await Promise.all([listUsers(), findSuperAdmins()]);
  s.stop(`${users.length} user${users.length === 1 ? "" : "s"}`);

  // Refuse unsafe repetition. A second super-admin is a legitimate need — the
  // brief calls for one, for organisational recovery — but it must be a decision
  // somebody made on purpose, not something a re-run of a script did quietly.
  if (admins.length && !FORCE) {
    note(
      admins.map((a) => `${pc.bold(a.email)}  ${pc.dim(a.id)}`).join("\n"),
      "A super-admin already exists",
    );
    log.warn(
      "A second super-admin should only be added for organisational recovery,\n" +
        "and it must be a separate account with separate credentials.\n\n" +
        `Re-run with ${accent("--force")} if that is genuinely what you are doing.`,
    );
    outro("Nothing changed.");
    return;
  }

  const eligible = users.filter((u) => u.email_verified);
  if (!eligible.length) {
    log.error(
      "No verified user to promote. Sign in at least once first — a super-admin\n" +
        "must be a real person who has proven they control the mailbox.",
    );
    outro("Nothing changed.");
    return;
  }

  const chosen = abortIfCancelled(
    await select({
      message: "Promote which account to super_admin?",
      options: eligible.map((u) => ({
        value: u.id,
        label: u.email,
        hint: `${u.role ?? "user"}${u.recovery_email ? "" : "  no recovery email"}`,
      })),
    }),
  ) as string;

  const user = eligible.find((u) => u.id === chosen)!;

  // Passwordless plus an institutional-only gate means the college can revoke
  // this person's only credential on a scheduled date. For an ordinary student
  // that is an inconvenience. For the account that manages OAuth clients and
  // assigns central roles, it is the loss of the root of trust.
  if (!user.recovery_email) {
    log.warn(
      `${pc.bold(user.email)} has no recovery email.\n\n` +
        "@vit.edu.in is revoked at graduation and there is no password to fall\n" +
        "back on. A super-admin without a durable address is a super-admin you\n" +
        "will lose on a known date.",
    );
    const proceed = abortIfCancelled(
      await confirm({
        message: "Promote anyway? (add a recovery email before you graduate)",
        initialValue: false,
      }),
    );
    if (!proceed) {
      outro("Nothing changed. Add a recovery email, then re-run.");
      return;
    }
  }

  const reason = abortIfCancelled(
    await text({
      message: "Why? (recorded in the audit log, permanently)",
      placeholder: "Founding lab lead — initial bootstrap",
      validate: (v) => (!v?.trim() ? "Required" : undefined),
    }),
  );

  const sure = abortIfCancelled(
    await confirm({
      message: `Grant super_admin to ${pc.bold(user.email)}?`,
      initialValue: false,
    }),
  );
  if (!sure) {
    outro("Nothing changed.");
    return;
  }

  const s2 = spinner();
  s2.start("Promoting");
  await promote(user, reason.trim());
  s2.stop(`${accent(user.email)} is now super_admin`);

  note(
    "Search and inspect users\nRevoke sessions\nDisable compromised accounts\nAssign central roles\n\n" +
      pc.dim(
        "Not: impersonation, password setting, or hard delete —\nwithheld from every role, including this one.",
      ),
    "What this account can now do",
  );

  outro("Recorded in audit_log. This cannot be undone silently.");
}

main().catch((err) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
