import { useState } from "react";
import { Form, redirect, useNavigate, useNavigation } from "react-router";

import type { Route } from "./+types/account";
import { auth, getDb } from "~/lib/auth.server";
import * as schema from "~/db";
import { authClient } from "~/lib/auth-client";
import { confirmRecoveryCode, sendRecoveryCode } from "~/lib/recovery.server";
import {
  disconnectApp,
  listConnectedApps,
  parseUserAgent,
  relativeTime,
} from "~/lib/account.server";
// Everything from a .server module must stay inside loader/action. React Router
// strips server code from those exports only — reaching for one from the
// component pulls the whole module, and the database driver with it, into the
// client bundle, and the build fails.
import { audit } from "~/lib/audit.server";
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

const SCOPE_COPY: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "Your name",
  email: "Your college email address",
  offline_access: "Stay signed in while you are away",
};

// auth.api.getSession, not a fetch to /api/auth/get-session. The direct call is
// built once at init; the HTTP endpoint rebuilds better-auth's entire router on
// every request (#10188). That gap is why this app is SSR rather than a SPA.
export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/sign-in");

  const db = getDb();
  const [sessions, apps] = await Promise.all([
    auth.api.listSessions({ headers: request.headers }),
    listConnectedApps(db, session.user.id),
  ]);

  return {
    email: session.user.email,
    name: session.user.name,
    role: session.user.role ?? "user",
    recoveryEmail: session.user.recoveryEmail ?? null,
    currentToken: session.session.token,
    apps: apps.map((a) => ({
      ...a,
      connectedLabel: relativeTime(a.connectedAt),
    })),
    sessions: (sessions ?? []).map((s) => {
      const { browser, os } = parseUserAgent(s.userAgent ?? null);
      return {
        token: s.token,
        browser,
        os,
        ipAddress: s.ipAddress || null,
        created: relativeTime(String(s.createdAt)),
      };
    }),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/sign-in");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const db = getDb();

  try {
    switch (intent) {
      case "send-code":
        await sendRecoveryCode(
          db,
          schema,
          session.user.id,
          String(form.get("recoveryEmail") ?? "")
        );
        return { step: "code" as const, error: null, done: null };

      case "confirm-code":
        await confirmRecoveryCode(
          db,
          schema,
          session.user.id,
          String(form.get("code") ?? "")
        );
        await audit(db, {
          action: "user.recovery_email_verified",
          actorId: session.user.id,
          actorEmail: session.user.email,
          targetType: "user",
          targetId: session.user.id,
          request,
        });
        return { step: "email" as const, error: null, done: "recovery" as const };

      case "revoke-session":
        await auth.api.revokeSession({
          headers: request.headers,
          body: { token: String(form.get("token") ?? "") },
        });
        return { step: "email" as const, error: null, done: null };

      case "revoke-others":
        await auth.api.revokeOtherSessions({ headers: request.headers });
        return { step: "email" as const, error: null, done: null };

      case "disconnect": {
        const clientId = String(form.get("clientId") ?? "");
        await disconnectApp(db, session.user.id, clientId);
        await audit(db, {
          action: "app.disconnected",
          actorId: session.user.id,
          actorEmail: session.user.email,
          targetType: "oauth_client",
          targetId: clientId,
          request,
        });
        return {
          step: "email" as const,
          error: null,
          done: "disconnect" as const,
        };
      }
    }
  } catch (err) {
    return {
      step: intent === "confirm-code" ? ("code" as const) : ("email" as const),
      error: err instanceof Error ? err.message : "Something went wrong.",
      done: null,
    };
  }

  return { step: "email" as const, error: null, done: null };
}

export default function Account({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { email, name, role, recoveryEmail, sessions, currentToken, apps } =
    loaderData;
  const navigate = useNavigate();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [editing, setEditing] = useState(false);
  const error = actionData?.error ?? null;
  const showCode = editing && actionData?.step === "code" && !actionData?.done;
  const otherSessions = sessions.filter((s) => s.token !== currentToken);

  return (
    <main className="relative flex min-h-svh justify-center overflow-hidden p-6 py-16">
      <div className="voss-grid pointer-events-none absolute inset-0" />
      <div className="voss-glow pointer-events-none absolute inset-0" />

      <div className="voss-rise relative w-full max-w-md">
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
            {recoveryEmail && !editing && (
              <span className="font-mono text-xs">{recoveryEmail}</span>
            )}
          </div>

          {!recoveryEmail && !editing && (
            <>
              <p className="border-primary/40 bg-primary/5 text-muted-foreground mt-4 border-l-2 py-2 pl-4 text-xs leading-relaxed">
                Your college email stops working when you graduate, and there is
                no password to fall back on. Without a personal address, you lose
                this account on a known date.
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
                A personal address you keep after graduating &mdash; not your
                college one, which is the address you are protecting against
                losing.
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
                We sent a 6-digit code there. Enter it to prove you control the
                mailbox &mdash; an unverified recovery address is not a recovery
                address.
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

          {actionData?.done === "recovery" && (
            <p className="mt-3 text-xs text-emerald-500">
              Recovery email verified.
            </p>
          )}
        </section>

        {/* Connected apps -------------------------------------------------- */}
        <section className="border-border mt-6 border-t pt-6">
          <p className="text-muted-foreground text-sm">
            Connected apps {apps.length > 0 && `(${apps.length})`}
          </p>

          {!apps.length ? (
            <p className="text-muted-foreground/60 mt-3 text-xs leading-relaxed">
              No VOSS product has access to this account yet. When you sign in to
              VERP or vboard, it appears here.
            </p>
          ) : (
            <ul className="mt-4 space-y-5">
              {apps.map((app) => (
                <li key={app.clientId}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-medium">{app.name}</span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="disconnect" />
                      <input
                        type="hidden"
                        name="clientId"
                        value={app.clientId}
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive text-xs underline-offset-4 transition-colors hover:underline disabled:opacity-50"
                      >
                        Remove access
                      </button>
                    </Form>
                  </div>

                  <ul className="mt-2 space-y-1">
                    {app.scopes.map((s) => (
                      <li
                        key={s}
                        className="text-muted-foreground flex items-start gap-2 text-xs"
                      >
                        <span
                          aria-hidden
                          className="bg-primary mt-[6px] size-[4px] shrink-0"
                        />
                        {SCOPE_COPY[s] ?? s}
                      </li>
                    ))}
                  </ul>

                  {app.connectedLabel && (
                    <p className="text-muted-foreground/60 mt-2 text-xs">
                      Connected {app.connectedLabel}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {actionData?.done === "disconnect" && (
            <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
              Access removed &mdash; VOSS will issue that app no new tokens.
              <br />
              <span className="text-yellow-500/80">
                It may keep you signed in on its own until that session expires.
              </span>{" "}
              To leave immediately, sign out inside the app itself.
            </p>
          )}
        </section>

        {/* Sessions -------------------------------------------------------- */}
        <section className="border-border mt-6 border-t pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              Where you are signed in ({sessions.length})
            </p>
            {otherSessions.length > 0 && (
              <Form method="post">
                <input type="hidden" name="intent" value="revoke-others" />
                <button
                  type="submit"
                  disabled={busy}
                  className="text-muted-foreground hover:text-destructive text-xs underline-offset-4 transition-colors hover:underline disabled:opacity-50"
                >
                  Sign out everywhere else
                </button>
              </Form>
            )}
          </div>

          <ul className="mt-4 space-y-3">
            {sessions.map((s) => {
              const current = s.token === currentToken;
              return (
                <li
                  key={s.token}
                  className="flex items-start justify-between gap-4"
                >
                  <div className="text-xs leading-relaxed">
                    <span className="text-foreground">
                      {s.browser} on {s.os}
                    </span>
                    {current && (
                      <span className="text-primary ml-2">this device</span>
                    )}
                    <span className="text-muted-foreground/60 block font-mono">
                      {s.ipAddress ?? "unknown IP"}
                      {s.created && ` · ${s.created}`}
                    </span>
                  </div>

                  {!current && (
                    <Form method="post">
                      <input
                        type="hidden"
                        name="intent"
                        value="revoke-session"
                      />
                      <input type="hidden" name="token" value={s.token} />
                      <button
                        type="submit"
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive shrink-0 text-xs underline-offset-4 transition-colors hover:underline disabled:opacity-50"
                      >
                        Sign out
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
