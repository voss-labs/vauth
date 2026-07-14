import { Link, NavLink, Outlet } from "react-router";

import type { Route } from "./+types/super-admin";
import { countStats, requireAdmin } from "~/lib/admin.server";
import { VossMark } from "~/components/voss-mark";

export function meta() {
  return [{ title: "Identity console — VOSS" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  // Moving off /admin only reduces drive-by scanner noise — it is not a lock.
  // THIS is the lock, it runs server-side, and it runs again in every child
  // loader and action. Hiding a link is a UI convenience, never a permission.
  const actor = await requireAdmin(request);
  return { actor, stats: await countStats() };
}

const NAV = [
  { to: "/super-admin", label: "Accounts", end: true },
  { to: "/super-admin/clients", label: "Clients" },
  { to: "/super-admin/audit", label: "Audit" },
];

export default function ConsoleLayout({ loaderData }: Route.ComponentProps) {
  const { actor, stats } = loaderData;

  return (
    // h-svh + overflow-hidden: the console is a workspace, not a document. The
    // page itself never scrolls — only the table inside it does.
    <div className="relative flex h-svh overflow-hidden">
      <div className="voss-grid pointer-events-none absolute inset-0" />

      {/* Sidebar ------------------------------------------------------- */}
      <aside className="border-border bg-card/40 relative flex w-60 shrink-0 flex-col border-r px-5 py-6 backdrop-blur-sm">
        <VossMark status="idle" className="mb-8" />

        <nav className="space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <dl className="border-border mt-8 space-y-2.5 border-t pt-6 text-xs">
          {[
            ["Accounts", stats.users],
            ["Super-admins", stats.superAdmins],
            ["Sessions", stats.sessions],
            ["Clients", stats.clients],
          ].map(([label, n]) => (
            <div key={String(label)} className="flex justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono">{n}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-auto pt-6">
          {/* Stated in the product, not only in a comment. A reader should not
              have to take our word for what this console cannot do. */}
          <p className="text-muted-foreground/50 border-border border-l-2 py-1 pl-3 text-xs leading-relaxed">
            Cannot impersonate, set a password, or delete an account. Withheld
            from every role, including this one.
          </p>

          <div className="border-border mt-5 border-t pt-5 text-xs">
            <p className="truncate font-mono">{actor.email}</p>
            <p className="text-primary mt-0.5 font-mono">{actor.role}</p>
            <Link
              to="/account"
              className="text-muted-foreground hover:text-foreground mt-2 inline-block underline-offset-4 transition-colors hover:underline"
            >
              Your account &rarr;
            </Link>
          </div>
        </div>
      </aside>

      {/* Content -------------------------------------------------------- */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden px-8 py-6">
        <Outlet context={actor} />
      </main>
    </div>
  );
}
