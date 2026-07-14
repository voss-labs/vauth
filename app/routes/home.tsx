import { redirect, useNavigate } from "react-router";

import type { Route } from "./+types/home";
import { auth } from "~/lib/auth.server";
import { authClient } from "~/lib/auth-client";
import { VossMark } from "~/components/voss-mark";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "Your VOSS account" }];
}

// auth.api.getSession, not a fetch to /api/auth/get-session. The direct call is
// built once at init; the HTTP endpoint rebuilds better-auth's entire router on
// every request (issue #10188). Against the Workers free tier's 10ms CPU budget
// that difference is the whole reason this app is SSR rather than a SPA.
export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/sign-in");

  return {
    email: session.user.email,
    name: session.user.name,
    role: session.user.role ?? "user",
    recoveryEmail: session.user.recoveryEmail ?? null,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { email, name, role, recoveryEmail } = loaderData;
  const navigate = useNavigate();

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden p-6">
      <div className="voss-grid pointer-events-none absolute inset-0" />
      <div className="voss-glow pointer-events-none absolute inset-0" />

      <div className="voss-rise relative w-full max-w-sm">
        <VossMark status="ok" className="mb-9" />

        <h1 className="text-2xl font-semibold tracking-tight">
          {name || "Signed in"}
        </h1>
        <p className="text-muted-foreground mt-2 font-mono text-sm">{email}</p>

        <dl className="border-border mt-7 space-y-4 border-t pt-6 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Central role</dt>
            <dd className="font-mono">{role}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Recovery email</dt>
            <dd
              className={recoveryEmail ? "font-mono" : "text-muted-foreground"}
            >
              {recoveryEmail ?? "Not set"}
            </dd>
          </div>
        </dl>

        {!recoveryEmail && (
          <p className="border-primary/40 bg-primary/5 text-muted-foreground mt-6 border-l-2 py-2 pl-4 text-xs leading-relaxed">
            Your college email stops working when you graduate, and there is no
            password to fall back on. Add a personal address so you can still
            reach your account.
          </p>
        )}

        <Button
          variant="outline"
          className="mt-8 h-11 w-full"
          onClick={() =>
            authClient.signOut({
              fetchOptions: { onSuccess: () => navigate("/sign-in") },
            })
          }
        >
          Sign out
        </Button>

        <p className="text-muted-foreground/70 mt-12 text-xs">
          VOSS Labs &middot; Vidyalankar Institute of Technology
        </p>
      </div>
    </main>
  );
}
