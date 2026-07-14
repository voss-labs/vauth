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
} from "@clack/prompts";
import pc from "picocolors";

import {
  audit,
  generateClientSecret,
  hashClientSecret,
  sql,
} from "./lib/admin";
import { accent, banner, secretBox, voss } from "./lib/brand";
import { DISCOVERY_URL } from "../app/lib/config";

function die(message: string): never {
  cancel(message);
  process.exit(0);
}

function ask<T>(value: T | symbol): T {
  if (isCancel(value)) die("Cancelled. Nothing was changed.");
  return value as T;
}

async function main() {
  console.log(banner("rotate a client secret"));
  intro(`${voss()}  ${pc.dim("vauth")}`);

  if (!process.env.DATABASE_URL)
    die("DATABASE_URL is not set. Check your .env.");

  const clients = (await sql()`
    SELECT client_id, name FROM oauth_client WHERE disabled = false ORDER BY created_at
  `) as Array<{ client_id: string; name: string | null }>;

  if (!clients.length) {
    log.warn("No clients registered. Run `npm run clients` first.");
    outro("Nothing to rotate.");
    return;
  }

  const clientId = ask(
    await select({
      message: "Rotate the secret for which product?",
      options: clients.map((c) => ({
        value: c.client_id,
        label: c.name ?? c.client_id,
        hint: c.client_id,
      })),
    }),
  ) as string;

  const client = clients.find((c) => c.client_id === clientId)!;

  log.warn(
    "The old secret stops working the moment this completes.\n" +
      `${client.name} will be unable to sign anyone in until you paste the new\n` +
      "one into its environment and redeploy.",
  );

  const sure = ask(
    await confirm({
      message: `Rotate the secret for ${pc.bold(client.name ?? clientId)}?`,
      initialValue: false,
    }),
  );
  if (!sure) {
    outro("Nothing changed.");
    return;
  }

  const s = spinner();
  s.start("Rotating");

  const secret = generateClientSecret();
  const stored = await hashClientSecret(secret);

  await sql()`
    UPDATE oauth_client
    SET client_secret = ${stored}, updated_at = now()
    WHERE client_id = ${clientId}
  `;

  // Tokens issued under the old secret keep working until they expire — the
  // secret authenticates the CLIENT at the token endpoint, not the user. If the
  // secret leaked, the tokens must go too.
  await audit({
    action: "client.secret_rotated",
    actorEmail: "cli",
    targetType: "oauth_client",
    targetId: clientId,
    details: { name: client.name },
  });

  s.stop(`Rotated ${accent(client.name ?? clientId)}`);

  note(
    secretBox([
      ["VOSS_CLIENT_ID", clientId],
      ["VOSS_CLIENT_SECRET", secret],
      ["VOSS_DISCOVERY_URL", DISCOVERY_URL],
    ]),
    `${client.name} — paste into its .env now`,
  );

  log.warn(
    pc.yellow(
      "Hashed at rest. This is the only time it is shown.\n" +
        "Lose it again and you rotate again — there is no recovery.",
    ),
  );

  outro("Recorded in audit_log.");
}

main().catch((err) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
