import type { Route } from "./+types/super-admin.clients";
import { listClients, requireAdmin } from "~/lib/admin.server";
import { relativeTime } from "~/lib/account.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const clients = await listClients();
  return {
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

export default function AdminClients({ loaderData }: Route.ComponentProps) {
  const { clients } = loaderData;

  return (
    <>
      <header className="shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
      </header>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {/* Read-only, deliberately. A redirect URI IS the security boundary:
          anyone who can add one can have authorization codes delivered to a
          server they control, and become any student. That change belongs in a
          reviewed pull request against clients.config.ts, not in a web form
          behind a session someone might have stolen. */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          Read-only. Clients are registered from{" "}
          <span className="font-mono">clients.config.ts</span> with{" "}
          <span className="font-mono">npm run clients</span> &mdash; a redirect
          URI is the security boundary, and adding one should arrive as a
          reviewed pull request, not a web form.
        </p>

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
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
