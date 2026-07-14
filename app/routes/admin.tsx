import { Form, Link, NavLink, Outlet, useSearchParams } from "react-router";

import type { Route } from "./+types/admin";
import { requireAdmin, countStats } from "~/lib/admin.server";
import { VossMark } from "~/components/voss-mark";

export function meta() {
  return [{ title: "Identity console — VOSS" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requireAdmin(request);
  return { actor, stats: await countStats() };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { actor, stats } = loaderData;
  const [params] = useSearchParams();

  const tabs = [
    { to: "/admin", label: "Users", end: true },
    { to: "/admin/audit", label: "Audit" },
    { to: "/admin/clients", label: "Clients" },
  ];

  return (
    <div className="relative min-h-svh overflow-hidden">
      <div className="voss-grid pointer-events-none absolute inset-0" />

      <div className="relative mx-auto w-full max-w-3xl px-6 py-12">
        <header className="flex items-start justify-between gap-6">
          <div>
            <VossMark status="idle" className="mb-6" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Identity console
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {stats.users} account{stats.users === 1 ? "" : "s"} &middot;{" "}
              {stats.sessions} session{stats.sessions === 1 ? "" : "s"} &middot;{" "}
              {stats.clients} client{stats.clients === 1 ? "" : "s"}
            </p>
          </div>

          <div className="text-right text-xs">
            <p className="font-mono">{actor.email}</p>
            <p className="text-primary mt-1 font-mono">{actor.role}</p>
            <Link
              to="/account"
              className="text-muted-foreground hover:text-foreground mt-2 inline-block underline-offset-4 transition-colors hover:underline"
            >
              Your account
            </Link>
          </div>
        </header>

        {/* What this console deliberately cannot do. Stated in the product, not
            just in a comment, because a reader should not have to trust us. */}
        <p className="text-muted-foreground/60 border-border mt-8 border-l-2 py-1 pl-4 text-xs leading-relaxed">
          This console cannot impersonate a student, set anyone&rsquo;s password,
          or delete an account. Those are withheld from every role, including
          super-admin.
        </p>

        <nav className="border-border mt-8 flex gap-6 border-b text-sm">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                [
                  "-mb-px border-b-2 pb-3 transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                ].join(" ")
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-8">
          <Outlet context={actor} />
        </div>
      </div>
    </div>
  );
}
