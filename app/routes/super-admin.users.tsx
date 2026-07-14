import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { ColumnDef } from "@tanstack/react-table";

import type { Route } from "./+types/super-admin.users";
import { requireAdmin, searchUsers } from "~/lib/admin.server";
import { relativeTime } from "~/lib/account.server";
import { DataTable } from "~/components/data-table";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  emailVerified: boolean;
  banned: boolean | null;
  recoveryEmail: string | null;
  joined: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const users = await searchUsers("");
  return {
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: u.emailVerified,
      banned: u.banned,
      recoveryEmail: u.recoveryEmail,
      joined: relativeTime(String(u.createdAt)),
    })) satisfies Row[],
  };
}

export default function ConsoleUsers({ loaderData }: Route.ComponentProps) {
  const { users } = loaderData;
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Account",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-mono">{row.original.email}</p>
            <p className="text-muted-foreground/60 truncate">
              {row.original.name || "no name"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Central role",
        cell: ({ getValue }) => {
          const role = (getValue() as string) ?? "user";
          return (
            <span
              className={
                role === "user"
                  ? "text-muted-foreground/60 font-mono"
                  : "text-primary font-mono"
              }
            >
              {role}
            </span>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1.5">
            {row.original.banned && (
              <Badge variant="destructive" className="text-xs">
                disabled
              </Badge>
            )}
            {!row.original.emailVerified && (
              <Badge variant="outline" className="text-xs text-yellow-500">
                unverified
              </Badge>
            )}
            {/* Not decoration. No recovery email means this person is locked out
                of their own account on a known date, and nobody can undo it. */}
            {!row.original.recoveryEmail && (
              <Badge
                variant="outline"
                className="text-muted-foreground/60 text-xs"
              >
                no recovery
              </Badge>
            )}
            {row.original.emailVerified &&
              !row.original.banned &&
              row.original.recoveryEmail && (
                <span className="text-muted-foreground/40">&mdash;</span>
              )}
          </div>
        ),
      },
      {
        accessorKey: "joined",
        header: "Joined",
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
          <h1 className="text-lg font-semibold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Click an account to inspect and manage it
          </p>
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by email, name or role"
          className="h-9 w-72 font-mono text-xs"
        />
      </header>

      <DataTable
        columns={columns}
        data={users}
        globalFilter={filter}
        onRowClick={(u) => navigate(`/super-admin/u/${u.id}`)}
        empty={filter ? `Nothing matches “${filter}”.` : "No accounts yet."}
        className="border-border bg-card/40 mt-5 min-h-0 flex-1 rounded-xl border backdrop-blur-sm"
      />
    </>
  );
}
