import { eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";

import type { Route } from "./+types/admin.user";
import { getDb } from "~/lib/auth.server";
import * as schema from "~/db";
import { audit } from "~/lib/audit.server";
import {
  getUserDetail,
  requireAdmin,
  requireSuperAdmin,
} from "~/lib/admin.server";
import { parseUserAgent, relativeTime } from "~/lib/account.server";
import { ROLES } from "~/lib/config";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export async function loader({ request, params }: Route.LoaderArgs) {
  const actor = await requireAdmin(request);
  const { user, sessions, events } = await getUserDetail(params.id);

  return {
    actor,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role ?? "user",
      emailVerified: user.emailVerified,
      banned: !!user.banned,
      banReason: user.banReason,
      recoveryEmail: user.recoveryEmail,
      recoveryVerified: !!user.recoveryEmailVerifiedAt,
      createdAt: relativeTime(String(user.createdAt)),
    },
    sessions: sessions.map((s) => {
      const { browser, os } = parseUserAgent(s.userAgent ?? null);
      return {
        id: s.id,
        label: `${browser} on ${os}`,
        ip: s.ipAddress || null,
        created: relativeTime(String(s.createdAt)),
      };
    }),
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      actorEmail: e.actorEmail,
      created: relativeTime(String(e.createdAt)),
    })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const db = getDb();
  const targetId = params.id;

  // An admin must not be able to lock themselves out, nor quietly strip the last
  // super-admin. Both are recoverable only from a laptop with database access.
  const self = targetId === actor.id;

  switch (intent) {
    case "disable": {
      if (self) return { error: "You cannot disable your own account." };
      const reason = String(form.get("reason") ?? "").trim();
      if (!reason) return { error: "A reason is required. It is recorded permanently." };

      // Disabled, never deleted: marks and audit trails must stay attributable.
      await db
        .update(schema.user)
        .set({ banned: true, banReason: reason })
        .where(eq(schema.user.id, targetId));
      await db.delete(schema.session).where(eq(schema.session.userId, targetId));

      await audit(db, {
        action: "user.disabled",
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "user",
        targetId,
        details: { reason },
        request,
      });
      return { error: null };
    }

    case "enable": {
      await db
        .update(schema.user)
        .set({ banned: false, banReason: null })
        .where(eq(schema.user.id, targetId));
      await audit(db, {
        action: "user.enabled",
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "user",
        targetId,
        request,
      });
      return { error: null };
    }

    case "revoke-sessions": {
      const gone = await db
        .delete(schema.session)
        .where(eq(schema.session.userId, targetId))
        .returning({ id: schema.session.id });
      await audit(db, {
        action: "session.revoked_all",
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "user",
        targetId,
        details: { count: gone.length },
        request,
      });
      return { error: null };
    }

    case "set-role": {
      requireSuperAdmin(actor);
      if (self) return { error: "You cannot change your own central role." };

      const role = String(form.get("role") ?? "");
      if (!Object.values(ROLES).includes(role as never)) {
        return { error: "Unknown role." };
      }

      const before = await db
        .select({ role: schema.user.role })
        .from(schema.user)
        .where(eq(schema.user.id, targetId));

      await db
        .update(schema.user)
        .set({ role })
        .where(eq(schema.user.id, targetId));

      await audit(db, {
        action: "user.role_changed",
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "user",
        targetId,
        details: { from: before[0]?.role ?? "user", to: role },
        request,
      });
      return { error: null };
    }
  }

  return { error: null };
}

export default function AdminUser({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { actor, user, sessions, events } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const self = user.id === actor.id;

  return (
    <div>
      <Link
        to="/admin"
        className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline"
      >
        &larr; All accounts
      </Link>

      <h2 className="mt-6 font-mono text-lg">{user.email}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {user.name || "no name"} &middot; joined {user.createdAt}
      </p>

      {actionData?.error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {actionData.error}
        </p>
      )}

      <dl className="border-border mt-8 grid grid-cols-2 gap-y-4 border-t pt-6 text-sm">
        <dt className="text-muted-foreground">Email verified</dt>
        <dd className={user.emailVerified ? "" : "text-yellow-500"}>
          {user.emailVerified ? "yes" : "no"}
        </dd>

        <dt className="text-muted-foreground">Central role</dt>
        <dd className="font-mono">{user.role}</dd>

        <dt className="text-muted-foreground">Recovery email</dt>
        <dd className="font-mono text-xs">
          {user.recoveryEmail ? (
            <>
              {user.recoveryEmail}
              {!user.recoveryVerified && (
                <span className="text-yellow-500"> (unverified)</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              none — locked out at graduation
            </span>
          )}
        </dd>

        <dt className="text-muted-foreground">Status</dt>
        <dd className={user.banned ? "text-destructive" : ""}>
          {user.banned ? `disabled — ${user.banReason}` : "active"}
        </dd>
      </dl>

      {/* Role assignment — super-admin only, enforced in the action too. */}
      {actor.isSuperAdmin && !self && (
        <section className="border-border mt-8 border-t pt-6">
          <p className="text-sm">Central role</p>
          <p className="text-muted-foreground/70 mt-1 text-xs leading-relaxed">
            Grants nothing inside VERP or vboard. Product roles live in each
            product&rsquo;s own database.
          </p>
          <Form method="post" className="mt-4 flex gap-3">
            <input type="hidden" name="intent" value="set-role" />
            <select
              name="role"
              defaultValue={user.role}
              className="border-input bg-background h-10 flex-1 rounded-md border px-3 font-mono text-sm"
            >
              <option value={ROLES.USER}>user</option>
              <option value={ROLES.IDENTITY_ADMIN}>identity_admin</option>
              <option value={ROLES.SUPER_ADMIN}>super_admin</option>
            </select>
            <Button type="submit" disabled={busy} className="h-10 text-sm">
              Set role
            </Button>
          </Form>
        </section>
      )}

      <section className="border-border mt-8 border-t pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm">Sessions ({sessions.length})</p>
          {sessions.length > 0 && (
            <Form method="post">
              <input type="hidden" name="intent" value="revoke-sessions" />
              <button
                type="submit"
                disabled={busy}
                className="text-muted-foreground hover:text-destructive text-xs underline-offset-4 transition-colors hover:underline disabled:opacity-50"
              >
                Revoke all
              </button>
            </Form>
          )}
        </div>
        <ul className="mt-4 space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="text-muted-foreground text-xs">
              {s.label}
              <span className="text-muted-foreground/50 ml-2 font-mono">
                {s.ip ?? "unknown IP"} · {s.created}
              </span>
            </li>
          ))}
          {!sessions.length && (
            <li className="text-muted-foreground/60 text-xs">
              Not signed in anywhere.
            </li>
          )}
        </ul>
      </section>

      <section className="border-border mt-8 border-t pt-6">
        <p className="text-sm">Account status</p>
        {user.banned ? (
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="enable" />
            <Button
              type="submit"
              variant="outline"
              disabled={busy}
              className="h-10 text-sm"
            >
              Re-enable this account
            </Button>
          </Form>
        ) : (
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="disable" />
            <Input
              name="reason"
              required
              placeholder="Why? Recorded permanently."
              className="h-10 text-sm"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={busy || self}
              className="text-destructive hover:bg-destructive/10 mt-3 h-10 text-sm"
            >
              {self ? "You cannot disable yourself" : "Disable and sign out everywhere"}
            </Button>
          </Form>
        )}
      </section>

      <section className="border-border mt-8 border-t pt-6">
        <p className="text-sm">Audit history</p>
        <ul className="mt-4 space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex justify-between gap-4 text-xs">
              <span className="font-mono">{e.action}</span>
              <span className="text-muted-foreground/60">
                {e.actorEmail ?? "—"} · {e.created}
              </span>
            </li>
          ))}
          {!events.length && (
            <li className="text-muted-foreground/60 text-xs">
              Nothing privileged has happened to this account.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
