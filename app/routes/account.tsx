import { useState } from "react";
import { Form, redirect, useNavigate, useNavigation } from "react-router";

import type { Route } from "./+types/account";
import { auth, getDb } from "~/lib/auth.server";
import * as schema from "~/db";
import { authClient } from "~/lib/auth-client";
import { sendRecoveryCode, confirmRecoveryCode } from "~/lib/recovery.server";
import { VossMark } from "~/components/voss-mark";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";

export function meta() {
  return [{ title: "Your VOSS account" }];
}

// auth.api.getSession, not a fetch to /api/auth/get-session. The direct call is
// built once at init; the HTTP endpoint rebuilds better-auth's entire router on
// every request (#10188). That gap is why this app is SSR rather than a SPA.
export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/sign-in");

  const sessions = await auth.api.listSessions({ headers: request.headers });

  return {
    email: session.user.email,
    name: session.user.name,
    role: session.user.role ?? "user",
    recoveryEmail: session.user.recoveryEmail ?? null,
    currentToken: session.session.token,
    sessions: (sessions ?? []).map((s) => ({
      id: s.id,
      token: s.token,
      createdAt: String(s.createdAt),
      userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress ?? null,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/sign-in");

  const form = await request.formData();
  const intent = form.get("intent");
  const db = getDb();

  try {
    if (intent === "send-code") {
      await sendRecoveryCode(
        db,
        schema,
        session.user.id,
        String(form.get("recoveryEmail") ?? ""),
      );
      return { step: "code" as const, error: null, done: false };
    }

    if (intent === "confirm-code") {
      await confirmRecoveryCode(
        db,
        schema,
        session.user.id,
        String(form.get("code") ?? ""),
      );
      return { step: "email" as const, error: null, done: true };
    }

    if (intent === "revoke") {
      await auth.api.revokeSession({
        headers: request.headers,
        body: { token: String(form.get("token") ?? "") },
      });
      return { step: "email" as const, error: null, done: false };
    }
  } catch (err) {
    return {
      step: intent === "confirm-code" ? ("code" as const) : ("email" as const),
      error: err instanceof Error ? err.message : "Something went wrong.",
      done: false,
    };
  }

  return { step: "email" as const, error: null, done: false };
}

function describe(ua: string | null) {
  if (!ua) return "Unknown device";
  if (/iphone|android|mobile/i.test(ua)) return "Mobile";
  if (/mac/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown device";
}

export default function Account({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { email, name, role, recoveryEmail, sessions, currentToken } =
    loaderData;
  const navigate = useNavigate();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [editing, setEditing] = useState(false);
  const step = actionData?.step ?? "email";
  const error = actionData?.error ?? null;
  const showCode = editing && step === "code" && !actionData?.done;

  return (
    <main className="relative flex min-h-svh justify-center overflow-hidden p-6 py-16">
      <div className="voss-grid pointer-events-none absolute inset-0" />
      <div className="voss-glow pointer-events-none absolute inset-0" />

      <div className="voss-rise relative w-full max-w-sm">
        <VossMark
          status={error ? "error" : busy ? "busy" : "ok"}
          className="mb-9"
        />

        <h1 className="text-2xl font-semibold tracking-tight">
          {name || "Your account"}
        </h1>
        <p className="text-muted-foreground mt-2 font-mono text-sm">{email}</p>

        <div className="border-border mt-7 flex items-baseline justify-between border-t pt-6 text-sm">
          <span className="text-muted-foreground">Central role</span>
          <span className="font-mono">{role}</span>
        </div>

        {/* Recovery ------------------------------------------------------- */}
        <section className="border-border mt-6 border-t pt-6">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Recovery email</span>
            {recoveryEmail && !editing ? (
              <span className="font-mono text-xs">{recoveryEmail}</span>
            ) : null}
          </div>

          {!recoveryEmail && !editing && (
            <>
              <p className="border-primary/40 bg-primary/5 text-muted-foreground mt-4 border-l-2 py-2 pl-4 text-xs leading-relaxed">
                Your college email stops working when you graduate, and there is
                no password to fall back on. Without a personal address, you
                lose this account on a known date.
              </p>
              <Button
                variant="outline"
                className="mt-4 h-10 w-full text-sm"
                onClick={() => setEditing(true)}
              >
                Add a recovery email
              </Button>
            </>
          )}

          {recoveryEmail && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-foreground mt-3 text-xs underline-offset-4 transition-colors hover:underline"
            >
              Change it
            </button>
          )}

          {editing && !showCode && (
            <Form method="post" className="mt-4">
              <input type="hidden" name="intent" value="send-code" />
              <Input
                name="recoveryEmail"
                type="email"
                autoFocus
                required
                placeholder="you@gmail.com"
                className="h-11 font-mono text-sm"
              />
              <p className="text-muted-foreground/70 mt-2 text-xs leading-relaxed">
                A personal address you will keep after you graduate. Not your
                college one &mdash; that is the address you are protecting
                against losing.
              </p>
              {error && (
                <p role="alert" className="text-destructive mt-3 text-sm">
                  {error}
                </p>
              )}
              <div className="mt-4 flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-1 text-sm"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy}
                  className="h-10 flex-1 text-sm"
                >
                  {busy ? "Sending…" : "Send code"}
                </Button>
              </div>
            </Form>
          )}

          {showCode && (
            <Form method="post" className="mt-4">
              <input type="hidden" name="intent" value="confirm-code" />
              <p className="text-muted-foreground text-xs leading-relaxed">
                We sent a 6-digit code to that address. Enter it to prove you
                control the mailbox &mdash; an unverified recovery address is
                not a recovery address.
              </p>
              <div className="mt-4">
                <InputOTP maxLength={6} name="code" autoFocus disabled={busy}>
                  <InputOTPGroup className="w-full justify-between gap-2">
                    {Array.from({ length: 6 }, (_, i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-12 flex-1 rounded-md font-mono"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {error && (
                <p role="alert" className="text-destructive mt-3 text-sm">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={busy}
                className="mt-4 h-10 w-full text-sm"
              >
                {busy ? "Verifying…" : "Verify"}
              </Button>
            </Form>
          )}

          {actionData?.done && (
            <p className="mt-3 text-xs text-emerald-500">
              Recovery email verified.
            </p>
          )}
        </section>

        {/* Sessions ------------------------------------------------------- */}
        <section className="border-border mt-6 border-t pt-6">
          <p className="text-muted-foreground text-sm">
            Active sessions ({sessions.length})
          </p>
          <ul className="mt-4 space-y-3">
            {sessions.map((s) => {
              const current = s.token === currentToken;
              return (
                <li
                  key={s.id}
                  className="flex items-baseline justify-between gap-4 text-xs"
                >
                  <span>
                    {describe(s.userAgent)}
                    {current && (
                      <span className="text-primary ml-2">this device</span>
                    )}
                    <span className="text-muted-foreground/60 ml-2 font-mono">
                      {s.ipAddress ?? ""}
                    </span>
                  </span>
                  {!current && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="token" value={s.token} />
                      <button
                        type="submit"
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive underline-offset-4 transition-colors hover:underline disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </Form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

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
