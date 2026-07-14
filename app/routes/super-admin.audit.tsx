import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import type { Route } from "./+types/super-admin.audit";
import { listAuditLog, requireAdmin } from "~/lib/admin.server";
import { relativeTime } from "~/lib/account.server";
import { DataTable } from "~/components/data-table";
import { Input } from "~/components/ui/input";

type Row = {
  id: string;
  action: string;
  actorEmail: string | null;
  detail: string;
  ip: string | null;
  when: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const events = await listAuditLog(200);

  return {
    events: events.map((e) => {
      const d = (e.details ?? {}) as Record<string, unknown>;
      const detail = [
        d.email,
        d.reason,
        d.to && `→ ${String(d.to)}`,
        d.name,
        d.count !== undefined && `${d.count} session(s)`,
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        id: e.id,
        action: e.action,
        actorEmail: e.actorEmail,
        detail,
        ip: e.ipAddress,
        when: relativeTime(String(e.createdAt)),
      };
    }) satisfies Row[],
  };
}

export default function ConsoleAudit({ loaderData }: Route.ComponentProps) {
  const { events } = loaderData;
  const [filter, setFilter] = useState("");

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ getValue }) => (
          <span className="font-mono">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "actorEmail",
        header: "By",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground/70 font-mono">
            {(getValue() as string) ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "detail",
        header: "Detail",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground/70">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "ip",
        header: "From",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground/50 font-mono">
            {(getValue() as string) ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "when",
        header: "When",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground/60">
            {getValue() as string}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audit</h1>
          {/* Rows are never deleted. An audit trail that can be edited is not one. */}
          <p className="text-muted-foreground mt-0.5 text-xs">
            Every privileged action, permanently. Nothing here can be deleted.
          </p>
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter"
          className="h-9 w-72 font-mono text-xs"
        />
      </header>

      <DataTable
        columns={columns}
        data={events}
        globalFilter={filter}
        empty={
          filter
            ? `Nothing matches “${filter}”.`
            : "Nothing privileged has happened yet."
        }
        className="border-border bg-card/40 mt-5 min-h-0 flex-1 rounded-xl border backdrop-blur-sm"
      />
    </>
  );
}
