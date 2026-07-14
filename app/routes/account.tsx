import { useState } from "react";
import { Form, Link, redirect, useNavigate, useNavigation } from "react-router";
import { eq } from "drizzle-orm";

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
import { audit } from "~/lib/audit.server";
import { ADMIN_ROLES, type Role } from "~/lib/config";
import { Panel, Row } from "~/components/card";
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

  const role = (session.user.role ?? "user") as Role;

  return {
    email: session.user.email,
    name: session.user.name ?? "",
    role,
    isAdmin: ADMIN_ROLES.includes(role),
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
      case "set-name": {
        // Name is identity data — it is what OIDC's `profile` scope carries. A
        // roll number is not: vauth holds no roster, so it could never verify one,
        // and an unverified self-claimed roll number is worse than none. That
        // binding belongs in the product, against the roster it actually has.
        const name = String(form.get("name") ?? "").trim().slice(0, 80);
        if (!name) return { error: "Name cannot be empty.", step: null, done: null };
        await db
          .update(schema.user)
          .set({ name })
          .where(eq(schema.user.id, session.user.id));
        return { error: null, step: null, done: "name" as const };
      }

      case "send-code":
        await sendRecoveryCode(
          db,
          schema,
          session.user.id,
          String(form.get("recoveryEmail") ?? "")
        );
        return { error: null, step: "code" as const, done: null };

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
        return { error: null, step: null, done: "recovery" as const };

      case "revoke-session":
        await auth.api.revokeSession({
          headers: request.headers,
          body: { token: String(form.get("token") ?? "") },
        });
        return { error: null, step: null, done: null };

      case "revoke-others":
        await auth.api.revokeOtherSessions({ headers: request.headers });
        return { error: null, step: null, done: null };

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
        return { error: null, step: null, done: "disconnect" as const };
      }
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Something went wrong.",
      step: intent === "confirm-code" ? ("code" as const) : null,
      done: null,
    };
  }

  return { error: null, step: null, done: null };
}

export default function Account({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    email,
    name,
    role,
    isAdmin,
    recoveryEmail,
    sessions,
    currentToken,
    apps,
  } = loaderData;

  const navigate = useNavigate();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [editingName, setEditingName] = useState(false);
  const [editingRecovery, setEditingRecovery] = useState(false);
  const error = actionData?.error ?? null;
  const showCode =
    editingRecovery && actionData?.step === "code" && !actionData?.done;
  const others = sessions.filter((s) => s.token !== currentToken);

  return (
    <div className="relative min-h-svh overflow-hidden">
      <div className="voss-grid pointer-events-none absolute inset-0" />
      <div className="voss-glow pointer-events-none absolute inset-0" />

      <div className="voss-rise relative mx-auto w-full max-w-4xl px-6 py-14">
        {/* Header ------------------------------------------------------- */}
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <VossMark
              status={error ? "error" : busy ? "busy" : "ok"}
              className="mb-6"
            />
            <h1 className="text-2xl font-semibold tracking-tight">
              {name || "Your account"}
            </h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              {email}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && (
              <Link
                to="/admin"
                className="border-border hover:bg-muted/50 rounded-md border px-3 py-2 text-xs transition-colors"
              >
                Identity console
              </Link>
            )}
            <Button
              variant="outline"
              className="h-9 text-xs"
              onClick={() =>
                authClient.signOut({
                  fetchOptions: { onSuccess: () => navigate("/sign-in") },
                })
              }
            >
              Sign out
            </Button>
          </div>
        </header>

        {error && (
          <p role="alert" className="text-destructive mt-6 text-sm">
            {error}
          </p>
        )}

        {/* Row 1: identity + recovery ----------------------------------- */}
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Panel
            title="Profile"
            action={
              !editingName && (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline"
                >
                  {name ? "Edit" : "Add your name"}
                </button>
              )
            }
          >
            {editingName ? (
              <Form method="post" onSubmit={() => setEditingName(false)}>
                <input type="hidden" name="intent" value="set-name" />
                <Input
                  name="name"
                  defaultValue={name}
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="Harshal More"
                  className="h-10 text-sm"
                />
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 flex-1 text-xs"
                    onClick={() => setEditingName(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="h-9 flex-1 text-xs"
                  >
                    Save
                  </Button>
                </div>
              </Form>
            ) : (
              <>
                <Row label="Name">
                  {name || (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </Row>
                <Row label="College email">
                  <span className="font-mono text-xs">{email}</span>
                </Row>
                <Row label="Central role">
                  <span
                    className={
                      role === "user"
                        ? "font-mono text-xs"
                        : "text-primary font-mono text-xs"
                    }
                  >
                    {role}
                  </span>
                </Row>
              </>
            )}
          </Panel>

          <Panel
            title="Recovery email"
            action={
              recoveryEmail &&
              !editingRecovery && (
                <button
                  type="button"
                  onClick={() => setEditingRecovery(true)}
                  className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline"
                >
                  Change
                </button>
              )
            }
          >
            {!editingRecovery && recoveryEmail && (
              <>
                <p className="font-mono text-sm break-all">{recoveryEmail}</p>
                <p className="text-muted-foreground/60 mt-3 text-xs leading-relaxed">
                  Verified. This is how you keep the account after your college
                  email is revoked.
                </p>
              </>
            )}

            {!editingRecovery && !recoveryEmail && (
              <>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Your college email stops working when you graduate, and there
                  is no password to fall back on. Without a personal address,
                  you lose this account on a known date.
                </p>
                <Button
                  variant="outline"
                  className="mt-4 h-9 w-full text-xs"
                  onClick={() => setEditingRecovery(true)}
                >
                  Add a recovery email
                </Button>
              </>
            )}

            {editingRecovery && !showCode && (
              <Form method="post">
                <input type="hidden" name="intent" value="send-code" />
                <Input
                  name="recoveryEmail"
                  type="email"
                  autoFocus
                  required
                  placeholder="you@gmail.com"
                  className="h-10 font-mono text-sm"
                />
                <p className="text-muted-foreground/70 mt-2 text-xs leading-relaxed">
                  A personal address you keep after graduating &mdash; not your
                  college one, which is the address you are protecting against
                  losing.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 flex-1 text-xs"
                    onClick={() => setEditingRecovery(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="h-9 flex-1 text-xs"
                  >
                    {busy ? "Sending…" : "Send code"}
                  </Button>
                </div>
              </Form>
            )}

            {showCode && (
              <Form method="post">
                <input type="hidden" name="intent" value="confirm-code" />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Enter the 6-digit code we sent there. An unverified recovery
                  address is not a recovery address.
                </p>
                <div className="mt-4">
                  <InputOTP maxLength={6} name="code" autoFocus disabled={busy}>
                    <InputOTPGroup className="w-full justify-between gap-1.5">
                      {Array.from({ length: 6 }, (_, i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          className="h-11 flex-1 rounded-md font-mono"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button
                  type="submit"
                  disabled={busy}
                  className="mt-3 h-9 w-full text-xs"
                >
                  {busy ? "Verifying…" : "Verify"}
                </Button>
              </Form>
            )}

            {actionData?.done === "recovery" && (
              <p className="mt-3 text-xs text-emerald-500">Verified.</p>
            )}
          </Panel>
        </div>

        {/* Row 2: connected apps ---------------------------------------- */}
        <Panel
          title={`Connected apps${apps.length ? ` (${apps.length})` : ""}`}
          className="mt-5"
        >
          {!apps.length ? (
            <p className="text-muted-foreground/60 text-xs leading-relaxed">
              No VOSS product has access to this account yet. When you sign in to
              VERP or vboard, it appears here.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              {apps.map((app) => (
                <div
                  key={app.clientId}
                  className="border-border rounded-lg border p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
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
                        Remove
                      </button>
                    </Form>
                  </div>
                  <ul className="mt-3 space-y-1">
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
                    <p className="text-muted-foreground/50 mt-3 text-xs">
                      Connected {app.connectedLabel}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {actionData?.done === "disconnect" && (
            <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
              Access removed &mdash; VOSS will issue that app no new tokens.{" "}
              <span className="text-yellow-500/80">
                It may keep you signed in on its own until that session expires.
              </span>{" "}
              To leave immediately, sign out inside the app itself.
            </p>
          )}
        </Panel>

        {/* Row 3: sessions ---------------------------------------------- */}
        <Panel
          title={`Where you are signed in (${sessions.length})`}
          className="mt-5"
          action={
            others.length > 0 && (
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
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {sessions.map((s) => {
              const current = s.token === currentToken;
              return (
                <div
                  key={s.token}
                  className={[
                    "flex items-start justify-between gap-3 rounded-lg border p-4",
                    current ? "border-primary/40 bg-primary/5" : "border-border",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      {s.browser} on {s.os}
                      {current && (
                        <span className="text-primary ml-2 text-xs">
                          this device
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground/60 mt-1 truncate font-mono text-xs">
                      {s.ipAddress ?? "unknown IP"}
                    </p>
                    <p className="text-muted-foreground/50 mt-0.5 text-xs">
                      {s.created}
                    </p>
                  </div>

                  {!current && (
                    <Form method="post" className="shrink-0">
                      <input
                        type="hidden"
                        name="intent"
                        value="revoke-session"
                      />
                      <input type="hidden" name="token" value={s.token} />
                      <button
                        type="submit"
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive text-xs underline-offset-4 transition-colors hover:underline disabled:opacity-50"
                      >
                        Sign out
                      </button>
                    </Form>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <p className="text-muted-foreground/50 mt-10 text-xs">
          VOSS Labs &middot; Vidyalankar Institute of Technology
        </p>
      </div>
    </div>
  );
}
