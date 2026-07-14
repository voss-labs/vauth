import { useState } from "react";
import { useSearchParams } from "react-router";

import { authClient } from "~/lib/auth-client";
import { VossMark } from "~/components/voss-mark";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "Authorize — VOSS" }];
}

// First-party clients (VERP, vboard) are registered with skip_consent, so nobody
// sees this in normal use. It exists for the day a client is NOT first-party —
// and on that day the page must state plainly what is being handed over.
const SCOPE_COPY: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "See your name",
  email: "See your college email address",
  offline_access: "Stay signed in when you are away",
};

export default function Consent() {
  const [params] = useSearchParams();
  const clientId = params.get("client_id") ?? "This application";
  const scopes = (params.get("scope") ?? "openid profile email")
    .split(" ")
    .filter(Boolean);

  const [busy, setBusy] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(accept ? "accept" : "deny");
    setError(null);
    const { error } = await authClient.oauth2.consent({ accept });
    if (error) {
      setBusy(null);
      setError(error.message ?? "Something went wrong. Try again.");
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden p-6">
      <div className="voss-grid pointer-events-none absolute inset-0" />
      <div className="voss-glow pointer-events-none absolute inset-0" />

      <div className="voss-rise relative w-full max-w-sm">
        <VossMark status={error ? "error" : busy ? "busy" : "idle"} className="mb-9" />

        <h1 className="text-2xl font-semibold tracking-tight">
          Authorize access
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          <span className="text-foreground font-mono">{clientId}</span> wants to
          use your VOSS account.
        </p>

        <ul className="border-border mt-7 space-y-3 border-t pt-6">
          {scopes.map((scope) => (
            <li key={scope} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className="bg-primary mt-[7px] size-[6px] shrink-0"
              />
              <span>{SCOPE_COPY[scope] ?? scope}</span>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground/70 mt-6 text-xs leading-relaxed">
          It will not receive your marks, attendance, or anything else held
          inside a VOSS product.
        </p>

        {error && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {error}
          </p>
        )}

        <div className="mt-8 flex gap-3">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => decide(false)}
            className="h-11 flex-1"
          >
            Cancel
          </Button>
          <Button
            disabled={!!busy}
            onClick={() => decide(true)}
            className="h-11 flex-1 font-medium"
          >
            {busy === "accept" ? "Authorizing…" : "Allow"}
          </Button>
        </div>
      </div>
    </main>
  );
}
