import { Form, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.users";
import { requireAdmin, searchUsers } from "~/lib/admin.server";
import { Input } from "~/components/ui/input";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return { q, users: await searchUsers(q) };
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { q, users } = loaderData;
  const [, setParams] = useSearchParams();

  return (
    <div>
      <Form
        onChange={(e) => {
          const value = new FormData(e.currentTarget).get("q");
          setParams(value ? { q: String(value) } : {}, { replace: true });
        }}
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by email or name"
          className="h-11 font-mono text-sm"
        />
      </Form>

      {!users.length ? (
        <p className="text-muted-foreground mt-8 text-sm">
          {q ? `Nothing matches “${q}”.` : "No accounts yet."}
        </p>
      ) : (
        <ul className="border-border mt-6 divide-y">
          {users.map((u) => (
            <li key={u.id}>
              <Link
                to={`/admin/u/${u.id}`}
                className="hover:bg-muted/40 -mx-3 flex items-center justify-between gap-4 rounded-md px-3 py-3 transition-colors"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{u.email}</p>
                  <p className="text-muted-foreground/70 mt-1 text-xs">
                    {u.name || "no name"}
                    {!u.emailVerified && (
                      <span className="text-yellow-500"> · unverified</span>
                    )}
                    {!u.recoveryEmail && (
                      <span className="text-muted-foreground/50">
                        {" "}
                        · no recovery email
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {u.banned && (
                    <span className="text-destructive text-xs">disabled</span>
                  )}
                  <span
                    className={[
                      "font-mono text-xs",
                      u.role === "super_admin"
                        ? "text-primary"
                        : u.role === "identity_admin"
                          ? "text-foreground"
                          : "text-muted-foreground/60",
                    ].join(" ")}
                  >
                    {u.role ?? "user"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
