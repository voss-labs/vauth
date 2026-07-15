import "dotenv/config";
import { spawnSync } from "node:child_process";
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
import { ROLES } from "../app/lib/config";

function die(message: string): never {
  cancel(message);
  process.exit(0);
}

function ask<T>(value: T | symbol): T {
  if (isCancel(value)) die("Cancelled.");
  return value as T;
}

function run(script: string, args: string[] = []) {
  spawnSync("npx", ["tsx", script, ...args], { stdio: "inherit" });
}

async function pickUser(message: string): Promise<DbUser | null> {
  const users = await listUsers();
  if (!users.length) {
    log.warn("No users yet. Somebody has to sign in first.");
    return null;
  }
  const id = ask(
    await select({
      message,
      options: users.map((u) => ({
        value: u.id,
        label: u.email,
        hint: [
          u.role ?? "user",
          u.email_verified ? "" : "unverified",
          u.recovery_email ? "" : "no recovery",
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    }),
  ) as string;
  return users.find((u) => u.id === id)!;
}

async function inspectUser() {
  const user = await pickUser("Inspect which account?");
  if (!user) return;

  const sessions = (await sql()`
    SELECT id, ip_address, user_agent, created_at, expires_at
    FROM session WHERE user_id = ${user.id} ORDER BY created_at DESC
  `) as any[];

  const events = (await sql()`
    SELECT action, created_at FROM audit_log
    WHERE target_id = ${user.id} ORDER BY created_at DESC LIMIT 5
  `) as any[];

  note(
    [
      `${pc.dim("id".padEnd(18))}${user.id}`,
      `${pc.dim("email".padEnd(18))}${user.email}`,
      `${pc.dim("verified".padEnd(18))}${user.email_verified ? "yes" : pc.red("no")}`,
      `${pc.dim("central role".padEnd(18))}${user.role ?? "user"}`,
      `${pc.dim("recovery email".padEnd(18))}${user.recovery_email ?? pc.yellow("not set — will be locked out at graduation")}`,
      `${pc.dim("sessions".padEnd(18))}${sessions.length}`,
      "",
      events.length
        ? pc.dim("recent audit:\n  ") +
          events.map((e) => `${e.action}`).join("\n  ")
        : pc.dim("no audit events"),
    ].join("\n"),
    user.email,
  );
}

async function revokeSessions() {
  const user = await pickUser("Revoke all sessions for which account?");
  if (!user) return;

  const sure = ask(
    await confirm({
      message: `Sign ${pc.bold(user.email)} out of every device?`,
      initialValue: false,
    }),
  );
  if (!sure) return;

  const s = spinner();
  s.start("Revoking");
  const r =
    (await sql()`DELETE FROM session WHERE user_id = ${user.id} RETURNING id`) as any[];
  await audit({
    action: "session.revoked_all",
    actorEmail: "cli",
    targetType: "user",
    targetId: user.id,
    details: { email: user.email, count: r.length },
  });
  s.stop(`Revoked ${r.length} session${r.length === 1 ? "" : "s"}`);
}

async function toggleDisabled() {
  const user = await pickUser("Disable or re-enable which account?");
  if (!user) return;

  const row =
    (await sql()`SELECT banned FROM "user" WHERE id = ${user.id}`) as any[];
  const banned = !!row[0]?.banned;

  if (banned) {
    const sure = ask(
      await confirm({
        message: `Re-enable ${pc.bold(user.email)}?`,
        initialValue: false,
      }),
    );
    if (!sure) return;
    await sql()`UPDATE "user" SET banned = false, ban_reason = NULL WHERE id = ${user.id}`;
    await audit({
      action: "user.enabled",
      actorEmail: "cli",
      targetType: "user",
      targetId: user.id,
      details: { email: user.email },
    });
    log.success(`${user.email} re-enabled`);
    return;
  }

  const reason = ask(
    await text({
      message: "Why? (recorded permanently)",
      placeholder: "Compromised account — reported by the student",
      validate: (v) => (!v?.trim() ? "Required" : undefined),
    }),
  );
  const sure = ask(
    await confirm({
      message: `Disable ${pc.bold(user.email)}? They will be signed out everywhere.`,
      initialValue: false,
    }),
  );
  if (!sure) return;

  // Disabled, never deleted. Marks and audit trails must stay attributable to a
  // real person, and a hard delete would orphan both.
  await sql()`UPDATE "user" SET banned = true, ban_reason = ${reason.trim()} WHERE id = ${user.id}`;
  await sql()`DELETE FROM session WHERE user_id = ${user.id}`;
  await audit({
    action: "user.disabled",
    actorEmail: "cli",
    targetType: "user",
    targetId: user.id,
    details: { email: user.email, reason: reason.trim() },
  });
  log.success(`${user.email} disabled and signed out everywhere`);
}

async function changeRole() {
  const user = await pickUser("Change the central role of which account?");
  if (!user) return;

  const role = ask(
    await select({
      message: `Central role for ${user.email}`,
      initialValue: user.role ?? ROLES.USER,
      options: [
        {
          value: ROLES.USER,
          label: "user",
          hint: "manages only their own account",
        },
        {
          value: ROLES.IDENTITY_ADMIN,
          label: "identity_admin",
          hint: "search, disable accounts, revoke sessions",
        },
        {
          value: ROLES.SUPER_ADMIN,
          label: "super_admin",
          hint: "the above, plus assigning central roles",
        },
      ],
    }),
  ) as string;

  if (role === user.role) return;

  log.info(
    pc.dim(
      "Central roles grant nothing inside VERP or vboard. Product roles\n" +
        "(student, faculty, hod) live in each product's own database.",
    ),
  );

  const sure = ask(
    await confirm({
      message: `Set ${pc.bold(user.email)} to ${accent(role)}?`,
      initialValue: false,
    }),
  );
  if (!sure) return;

  await sql()`UPDATE "user" SET role = ${role} WHERE id = ${user.id}`;
  await audit({
    action: "user.role_changed",
    actorEmail: "cli",
    targetType: "user",
    targetId: user.id,
    details: { email: user.email, from: user.role ?? "user", to: role },
  });
  log.success(`${user.email} is now ${role}`);
}

async function showClients() {
  const rows = (await sql()`
    SELECT client_id, name, redirect_uris, skip_consent, disabled, created_at
    FROM oauth_client ORDER BY created_at
  `) as any[];

  if (!rows.length) {
    log.warn("No OAuth clients. Nothing can log in yet.");
    return;
  }

  note(
    rows
      .map((c) =>
        [
          `${pc.bold(c.name)}${c.disabled ? pc.red("  DISABLED") : ""}`,
          `${pc.dim("  client_id  ")}${c.client_id}`,
          `${pc.dim("  redirects  ")}${c.redirect_uris.join("\n             ")}`,
          `${pc.dim("  consent    ")}${c.skip_consent ? "skipped (first-party)" : "required"}`,
        ].join("\n"),
      )
      .join("\n\n"),
    "Registered clients",
  );

  log.info(
    pc.dim(
      "Secrets are hashed at rest and cannot be shown again.\nIf one is lost, rotate it — you cannot recover it.",
    ),
  );
}

async function pickClient(message: string) {
  const clients = (await sql()`
    SELECT client_id, name, disabled FROM oauth_client ORDER BY created_at
  `) as Array<{ client_id: string; name: string | null; disabled: boolean }>;

  if (!clients.length) {
    log.warn("No OAuth clients registered. Run `npm run clients` first.");
    return null;
  }

  const clientId = ask(
    await select({
      message,
      options: clients.map((c) => ({
        value: c.client_id,
        label: c.name ?? c.client_id,
        hint: c.disabled ? pc.red("disabled") : c.client_id,
      })),
    }),
  ) as string;

  return clients.find((c) => c.client_id === clientId)!;
}

// Revoke is a soft disable, same as accounts: a client is never deleted, so its
// past authorizations stay attributable in the audit log and re-enabling needs
// no re-registration. The secret is left intact for exactly that reason.
async function toggleClientDisabled() {
  const client = await pickClient("Revoke or re-enable which client?");
  if (!client) return;
  const name = client.name ?? client.client_id;

  if (client.disabled) {
    const sure = ask(
      await confirm({
        message: `Re-enable ${pc.bold(name)}? It can sign people in again.`,
        initialValue: false,
      }),
    );
    if (!sure) return;
    await sql()`UPDATE oauth_client SET disabled = false, updated_at = now() WHERE client_id = ${client.client_id}`;
    await audit({
      action: "client.enabled",
      actorEmail: "cli",
      targetType: "oauth_client",
      targetId: client.client_id,
      details: { name: client.name },
    });
    log.success(`${name} re-enabled`);
    return;
  }

  log.warn(
    `${name} will stop being able to start a login the moment this completes.\n` +
      "Tokens already issued keep working until they expire; the secret is kept,\n" +
      "so re-enabling is a toggle, not a re-registration.",
  );
  const sure = ask(
    await confirm({
      message: `Revoke ${pc.bold(name)}?`,
      initialValue: false,
    }),
  );
  if (!sure) return;

  await sql()`UPDATE oauth_client SET disabled = true, updated_at = now() WHERE client_id = ${client.client_id}`;
  await audit({
    action: "client.disabled",
    actorEmail: "cli",
    targetType: "oauth_client",
    targetId: client.client_id,
    details: { name: client.name },
  });
  log.success(`${name} revoked — it can no longer start a login`);
}

async function showAudit() {
  const rows = (await sql()`
    SELECT action, actor_email, target_type, target_id, details, created_at
    FROM audit_log ORDER BY created_at DESC LIMIT 15
  `) as any[];

  if (!rows.length) {
    log.info("No audit events yet.");
    return;
  }

  note(
    rows
      .map((e) => {
        const when = new Date(e.created_at)
          .toISOString()
          .slice(0, 16)
          .replace("T", " ");
        const who = e.details?.email ?? e.target_id?.slice(0, 12) ?? "";
        return `${pc.dim(when)}  ${pc.bold(e.action.padEnd(22))} ${pc.dim(who)}`;
      })
      .join("\n"),
    "Recent privileged actions",
  );
}

async function main() {
  console.log(banner("identity administration"));
  intro(`${voss()}  ${pc.dim("vauth")}`);

  if (!process.env.DATABASE_URL)
    die("DATABASE_URL is not set. Check your .env.");

  const s = spinner();
  s.start("Reading identity database");
  const [users, admins, clients] = await Promise.all([
    listUsers(),
    findSuperAdmins(),
    sql()`SELECT count(*)::int c FROM oauth_client` as Promise<any[]>,
  ]);
  s.stop(
    `${users.length} user${users.length === 1 ? "" : "s"} · ` +
      `${admins.length} super-admin${admins.length === 1 ? "" : "s"} · ` +
      `${clients[0].c} client${clients[0].c === 1 ? "" : "s"}`,
  );

  if (!admins.length) {
    log.warn(
      "No super-admin exists. Nothing privileged can be done until one is\n" +
        "bootstrapped, and that is deliberate.",
    );
  }

  for (;;) {
    const choice = ask(
      await select({
        message: "What do you want to do?",
        options: [
          {
            value: "inspect",
            label: "Inspect an account",
            hint: "role, sessions, recovery, audit",
          },
          {
            value: "role",
            label: "Change a central role",
            hint: "user / identity_admin / super_admin",
          },
          {
            value: "revoke",
            label: "Revoke all sessions",
            hint: "sign someone out everywhere",
          },
          {
            value: "disable",
            label: "Disable or re-enable an account",
            hint: "never deleted",
          },
          {
            value: "clients",
            label: "List OAuth clients",
            hint: "which products can log people in",
          },
          {
            value: "register",
            label: "Register clients from config",
            hint: "npm run clients",
          },
          {
            value: "add",
            label: "Add a new product",
            hint: "wizard → clients.config.ts",
          },
          {
            value: "rotate",
            label: "Re-register a client secret",
            hint: "rotate — issues a new secret to paste into the product",
          },
          {
            value: "revoke-client",
            label: "Revoke or re-enable a client",
            hint: "disable a product's access; never deleted",
          },
          {
            value: "audit",
            label: "Recent privileged actions",
            hint: "the audit log",
          },
          {
            value: "bootstrap",
            label: "Bootstrap the first super-admin",
            hint: "one-time",
          },
          { value: "quit", label: pc.dim("Quit") },
        ],
      }),
    ) as string;

    switch (choice) {
      case "inspect":
        await inspectUser();
        break;
      case "role":
        await changeRole();
        break;
      case "revoke":
        await revokeSessions();
        break;
      case "disable":
        await toggleDisabled();
        break;
      case "clients":
        await showClients();
        break;
      case "register":
        run("scripts/clients.ts");
        break;
      case "add":
        run("scripts/clients.ts", ["--add"]);
        break;
      case "rotate":
        run("scripts/rotate-secret.ts");
        break;
      case "revoke-client":
        await toggleClientDisabled();
        break;
      case "audit":
        await showAudit();
        break;
      case "bootstrap":
        run("scripts/bootstrap.ts");
        break;
      case "quit":
        outro("Everything privileged you did is in audit_log.");
        return;
    }
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
