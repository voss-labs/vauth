import type { Route } from "./+types/admin.audit";
import { listAuditLog, requireAdmin } from "~/lib/admin.server";
import { relativeTime } from "~/lib/account.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const events = await listAuditLog();
  return {
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      actorEmail: e.actorEmail,
      targetId: e.targetId,
      details: e.details as Record<string, unknown> | null,
      ip: e.ipAddress,
      created: relativeTime(String(e.createdAt)),
    })),
  };
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
  const { events } = loaderData;

  return (
    <div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Every privileged action, permanently. Rows are never deleted &mdash; an
        audit trail that can be edited is not one.
      </p>

      {!events.length ? (
        <p className="text-muted-foreground mt-8 text-sm">
          Nothing privileged has happened yet.
        </p>
      ) : (
        <ul className="border-border mt-6 divide-y">
          {events.map((e) => (
            <li key={e.id} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-sm">{e.action}</span>
                <span className="text-muted-foreground/60 shrink-0 text-xs">
                  {e.created}
                </span>
              </div>
              <p className="text-muted-foreground/70 mt-1 text-xs">
                by {e.actorEmail ?? "—"}
                {e.details?.reason ? ` · ${String(e.details.reason)}` : ""}
                {e.details?.to ? ` · → ${String(e.details.to)}` : ""}
                {e.ip ? ` · ${e.ip}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
