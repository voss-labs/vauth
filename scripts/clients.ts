import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  spinner,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import { neon } from "@neondatabase/serverless";

import { clients, type TrustedClient } from "../clients.config";
import { auth } from "../app/lib/auth.server";
import { accent, banner, secretBox, voss } from "./lib/brand";

const CONFIG_PATH = resolve(process.cwd(), "clients.config.ts");
const ADD_MODE = process.argv.includes("--add");

function die(message: string): never {
  cancel(message);
  process.exit(1);
}

function abortIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) die("Cancelled. Nothing was changed.");
  return value as T;
}

async function registeredClients() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT client_id, name, redirect_uris, scopes, skip_consent, disabled
    FROM oauth_client
  `;
  return rows as Array<{
    client_id: string;
    name: string | null;
    redirect_uris: string[];
    scopes: string[] | null;
    skip_consent: boolean | null;
    disabled: boolean | null;
  }>;
}

// Register through better-auth rather than an INSERT: it is what hashes the
// secret, and hand-rolling that would silently diverge from how the token
// endpoint verifies it.
async function register(client: TrustedClient) {
  const result = await auth.api.adminCreateOAuthClient({
    body: {
      client_name: client.name,
      redirect_uris: client.redirectUris,
      scope: client.scopes.join(" "),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      type: "web",
      // OAuth 2.1: PKCE is not optional, and a first-party product never asks
      // the student to authorize software VOSS already owns.
      require_pkce: true,
      skip_consent: client.firstParty,
    },
  });

  return {
    clientId: result.client_id as string,
    clientSecret: result.client_secret as string | undefined,
  };
}

async function addToConfig() {
  const name = abortIfCancelled(
    await text({
      message: "Product name",
      placeholder: "vboard",
      validate: (v) => (!v?.trim() ? "Required" : undefined),
    })
  );

  const description = abortIfCancelled(
    await text({
      message: "What is it?",
      placeholder: "Campus events platform",
      validate: (v) => (!v?.trim() ? "Required" : undefined),
    })
  );

  const prod = abortIfCancelled(
    await text({
      message: "Production callback URL",
      placeholder: `https://${name.toLowerCase()}.vosslabs.org/api/auth/oauth2/callback/voss`,
      validate: (v) => {
        if (!v?.trim()) return "Required";
        try {
          const u = new URL(v);
          if (u.protocol !== "https:") return "Production callbacks must be https";
        } catch {
          return "Not a valid URL";
        }
      },
    })
  );

  const dev = abortIfCancelled(
    await text({
      message: "Local dev callback URL (blank to skip)",
      placeholder: "http://localhost:3000/api/auth/oauth2/callback/voss",
      defaultValue: "",
    })
  );

  const firstParty = abortIfCancelled(
    await confirm({
      message: "Is this a VOSS product? (first-party skips the consent screen)",
      initialValue: true,
    })
  );

  const entry: TrustedClient = {
    name: name.trim(),
    description: description.trim(),
    redirectUris: [prod.trim(), ...(dev.trim() ? [dev.trim()] : [])],
    scopes: ["openid", "profile", "email"],
    firstParty,
  };

  const src = readFileSync(CONFIG_PATH, "utf8");
  const rendered = `  {
    name: ${JSON.stringify(entry.name)},
    description: ${JSON.stringify(entry.description)},
    redirectUris: [
${entry.redirectUris.map((u) => `      ${JSON.stringify(u)},`).join("\n")}
    ],
    scopes: [${entry.scopes.map((s) => JSON.stringify(s)).join(", ")}],
    firstParty: ${entry.firstParty},
  },
]`;

  writeFileSync(CONFIG_PATH, src.replace(/\n\];\s*$/, `\n${rendered};\n`));
  log.success(`Added ${accent(entry.name)} to clients.config.ts`);
  note(
    "Commit that file. The list of products that can log your students in\nshould arrive as a reviewed pull request, not a row someone inserted.",
    "One more thing"
  );

  return entry;
}

async function main() {
  console.log(banner("OAuth client registration"));
  intro(`${voss()}  ${pc.dim("vauth")}`);

  if (!process.env.DATABASE_URL) die("DATABASE_URL is not set. Check your .env.");

  let configured = clients;
  if (ADD_MODE) {
    const added = await addToConfig();
    configured = [...clients, added];
  }

  const s = spinner();
  s.start("Reading registered clients");
  const existing = await registeredClients();
  s.stop(
    `${existing.length} client${existing.length === 1 ? "" : "s"} registered`
  );

  const existingNames = new Set(existing.map((c) => c.name));
  const missing = configured.filter((c) => !existingNames.has(c.name));

  if (existing.length) {
    note(
      existing
        .map(
          (c) =>
            `${pc.bold(c.name ?? "?")}  ${pc.dim(c.client_id)}${c.disabled ? pc.red("  DISABLED") : ""}`
        )
        .join("\n"),
      "Already registered"
    );
  }

  if (!missing.length) {
    outro("Everything in clients.config.ts is registered. Nothing to do.");
    return;
  }

  const chosen = abortIfCancelled(
    await multiselect({
      message: "Register these products?",
      options: missing.map((c) => ({
        value: c.name,
        label: c.name,
        hint: c.description,
      })),
      initialValues: missing.map((c) => c.name),
      required: false,
    })
  ) as string[];

  if (!chosen.length) {
    outro("Nothing selected.");
    return;
  }

  for (const name of chosen) {
    const client = configured.find((c) => c.name === name)!;
    const s2 = spinner();
    s2.start(`Registering ${client.name}`);

    let issued: { clientId: string; clientSecret?: string };
    try {
      issued = await register(client);
    } catch (err) {
      s2.stop(pc.red(`Failed to register ${client.name}`));
      log.error(err instanceof Error ? err.message : String(err));
      continue;
    }

    s2.stop(`Registered ${accent(client.name)}`);

    note(
      secretBox([
        ["VOSS_CLIENT_ID", issued.clientId],
        ["VOSS_CLIENT_SECRET", issued.clientSecret ?? "(none — public client)"],
        [
          "VOSS_DISCOVERY_URL",
          `${process.env.BETTER_AUTH_URL}/api/auth/.well-known/openid-configuration`,
        ],
      ]),
      `${client.name} — copy into its .env now`
    );

    log.warn(
      pc.yellow(
        "The secret is hashed at rest. This is the only time it is shown.\nLose it and you must rotate, not recover."
      )
    );
  }

  outro(
    `Done. In the product: genericOAuth with ${accent("pkce: true")} — it defaults to false on the client and the provider requires it.`
  );
}

main().catch((err) => {
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
