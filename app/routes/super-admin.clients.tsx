import { Form, useNavigation } from "react-router";

import type { Route } from "./+types/super-admin.clients";
import { getDb } from "~/lib/auth.server";
import { audit } from "~/lib/audit.server";
import { assertSameOrigin } from "~/lib/csrf.server";
import {
  listClients,
  requireAdmin,
  requireSuperAdmin,
  setClientDisabled,
  rotateClientSecret,
} from "~/lib/admin.server";
import { relativeTime } from "~/lib/account.server";
import { DISCOVERY_URL } from "~/lib/config";
import { Button } from "~/components/ui/button";

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requireAdmin(request);
  const clients = await listClients();
  return {
    isSuperAdmin: actor.isSuperAdmin,
    clients: clients.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      name: c.name ?? c.clientId,
      redirectUris: c.redirectUris ?? [],
      scopes: c.scopes ?? [],
      skipConsent: !!c.skipConsent,
      disabled: !!c.disabled,
      created: relativeTime(String(c.createdAt)),
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const actor = await requireAdmin(request);
  // Managing OAuth clients is the root-of-trust's job, same as central roles.
  requireSuperAdmin(actor);
  assertSameOrigin(request);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const clientId = String(form.get("clientId") ?? "");
  if (!clientId) return { error: "No client specified." };

  const db = getDb();

  switch (intent) {
    case "disable":
    case "enable": {
      const disabled = intent === "disable";
      const row = await setClientDisabled(clientId, disabled);
      if (!row) return { error: "No such client." };
      await audit(db, {
        action: disabled ? "client.disabled" : "client.enabled",
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "oauth_client",
        targetId: clientId,
        details: { name: row.name },
        request,
      });
      return { error: null };
    }

    case "rotate": {
      const rotated = await rotateClientSecret(clientId);
      if (!rotated) return { error: "No such client." };
      await audit(db, {
        action: "client.secret_rotated",
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "oauth_client",
        targetId: clientId,
        details: { name: rotated.name },
        request,
      });
      // Returned to the page ONCE. Never stored in plaintext, never in the loader.
      return {
        error: null,
        secret: {
          clientId: rotated.clientId,
          name: rotated.name ?? rotated.clientId,
          value: rotated.secret,
        },
      };
    }
  }

  return { error: "Unknown action." };
}

export default function AdminClients({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { clients, isSuperAdmin } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const rotated = actionData && "secret" in actionData ? actionData.secret : null;

  return (
    <>
      <header className="shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
      </header>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {/* New clients and redirect URIs stay config-only, deliberately: a
          redirect URI IS the security boundary — anyone who can add one can have
          authorization codes delivered to a server they control. That belongs in
          a reviewed pull request against clients.config.ts, never a web form.
          Rotating a secret and revoking access only ever REDUCE a client's reach,
          so they are safe to do here. */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          New clients and redirect URIs are registered from{" "}
          <span className="font-mono">clients.config.ts</span> with{" "}
          <span className="font-mono">npm run clients</span> &mdash; a redirect
          URI is the security boundary, so adding one should arrive as a reviewed
          pull request. Rotating a secret or revoking access is safe to do here.
        </p>

        {actionData?.error && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {actionData.error}
          </p>
        )}

        {rotated && (
          <div className="border-border bg-card mt-4 rounded-xl border p-4">
            <p className="text-sm font-medium">
              New secret for {rotated.name}
            </p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Shown once — it is hashed at rest and cannot be recovered. Paste it
              into {rotated.name} and redeploy; the old secret has already
              stopped working.
            </p>
            <pre className="border-border bg-background mt-3 overflow-x-auto rounded-lg border p-3 font-mono text-xs">
              {`VOSS_CLIENT_ID=${rotated.clientId}\nVOSS_CLIENT_SECRET=${rotated.value}\nVOSS_DISCOVERY_URL=${DISCOVERY_URL}`}
            </pre>
          </div>
        )}

        {!clients.length ? (
          <p className="text-muted-foreground mt-8 text-sm">
            No clients registered. Nothing can log in yet.
          </p>
        ) : (
          <div className="mt-6 grid gap-4">
            {clients.map((c) => (
              <div
                key={c.id}
                className="border-border bg-card/60 rounded-xl border p-5"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="flex items-center gap-3 text-xs">
                    {c.disabled && (
                      <span className="text-destructive">disabled</span>
                    )}
                    {c.skipConsent && (
                      <span className="text-muted-foreground/60">
                        first-party
                      </span>
                    )}
                    <span className="text-muted-foreground/50">
                      {c.created}
                    </span>
                  </span>
                </div>

                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex gap-4">
                    <dt className="text-muted-foreground w-24 shrink-0">
                      client_id
                    </dt>
                    <dd className="font-mono break-all">{c.clientId}</dd>
                  </div>
                  <div className="flex gap-4">
                    <dt className="text-muted-foreground w-24 shrink-0">
                      redirect URIs
                    </dt>
                    <dd className="min-w-0 font-mono">
                      {c.redirectUris.map((u) => (
                        <span key={u} className="block break-all">
                          {u}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div className="flex gap-4">
                    <dt className="text-muted-foreground w-24 shrink-0">
                      scopes
                    </dt>
                    <dd className="font-mono">{c.scopes.join(" ")}</dd>
                  </div>
                </dl>

                {isSuperAdmin && (
                  <div className="border-border mt-4 flex flex-wrap gap-2 border-t pt-4">
                    <Form method="post">
                      <input type="hidden" name="clientId" value={c.clientId} />
                      <input type="hidden" name="intent" value="rotate" />
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={busy}
                        className="h-9 text-xs"
                      >
                        Re-register secret
                      </Button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="clientId" value={c.clientId} />
                      <input
                        type="hidden"
                        name="intent"
                        value={c.disabled ? "enable" : "disable"}
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={busy}
                        className={
                          c.disabled
                            ? "h-9 text-xs"
                            : "text-destructive hover:bg-destructive/10 h-9 text-xs"
                        }
                      >
                        {c.disabled ? "Re-enable" : "Revoke access"}
                      </Button>
                    </Form>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
