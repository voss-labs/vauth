import { and, eq, inArray } from "drizzle-orm";
import * as schema from "~/db";

export type ConnectedApp = {
  clientId: string;
  name: string;
  scopes: string[];
  connectedAt: string | null;
  expiresAt: string | null;
  hasRefreshToken: boolean;
};

// Derived from TOKENS, not from oauth_consent. First-party clients are registered
// with skip_consent, so they never write a consent row — reading consent would
// show an empty list while VERP happily held live tokens. What actually grants a
// product access is a token, so that is what we show and what we revoke.
export async function listConnectedApps(
  db: any,
  userId: string
): Promise<ConnectedApp[]> {
  const [access, refresh, clients] = await Promise.all([
    db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.userId, userId)),
    db
      .select()
      .from(schema.oauthRefreshToken)
      .where(eq(schema.oauthRefreshToken.userId, userId)),
    db.select().from(schema.oauthClient),
  ]);

  const byClient = new Map<string, ConnectedApp>();

  const upsert = (clientId: string, row: any, isRefresh: boolean) => {
    const client = clients.find((c: any) => c.clientId === clientId);
    if (!client) return;

    const existing = byClient.get(clientId);
    const connectedAt = row.createdAt ? new Date(row.createdAt).toISOString() : null;

    if (!existing) {
      byClient.set(clientId, {
        clientId,
        name: client.name ?? clientId,
        scopes: row.scopes ?? [],
        connectedAt,
        expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        hasRefreshToken: isRefresh,
      });
      return;
    }

    existing.hasRefreshToken ||= isRefresh;
    existing.scopes = Array.from(new Set([...existing.scopes, ...(row.scopes ?? [])]));
    if (connectedAt && (!existing.connectedAt || connectedAt < existing.connectedAt)) {
      existing.connectedAt = connectedAt;
    }
  };

  for (const r of access) upsert(r.clientId, r, false);
  for (const r of refresh) upsert(r.clientId, r, true);

  return [...byClient.values()];
}

/**
 * Revoking access means destroying every token AND the consent record, so the
 * next authorization starts from zero.
 *
 * It does NOT sign the user out of the product. better-auth has no front-channel
 * logout, so VERP keeps its own local session until it expires. The UI says so
 * plainly — an account page that implies more than it delivers is worse than one
 * that admits the gap.
 */
export async function disconnectApp(db: any, userId: string, clientId: string) {
  const refresh = await db
    .select({ id: schema.oauthRefreshToken.id })
    .from(schema.oauthRefreshToken)
    .where(
      and(
        eq(schema.oauthRefreshToken.userId, userId),
        eq(schema.oauthRefreshToken.clientId, clientId)
      )
    );

  await db
    .delete(schema.oauthAccessToken)
    .where(
      and(
        eq(schema.oauthAccessToken.userId, userId),
        eq(schema.oauthAccessToken.clientId, clientId)
      )
    );

  if (refresh.length) {
    await db.delete(schema.oauthRefreshToken).where(
      inArray(
        schema.oauthRefreshToken.id,
        refresh.map((r: any) => r.id)
      )
    );
  }

  await db
    .delete(schema.oauthConsent)
    .where(
      and(
        eq(schema.oauthConsent.userId, userId),
        eq(schema.oauthConsent.clientId, clientId)
      )
    );
}

export type Device = {
  browser: string;
  os: string;
};

// Deliberately crude. Full UA parsing needs a library that ships a database of
// thousands of strings and is stale the week it is published; all we owe the user
// is enough to recognise their own device in a list.
export function parseUserAgent(ua: string | null): Device {
  if (!ua) return { browser: "Unknown browser", os: "Unknown device" };

  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
      ? "Opera"
      : /chrome|crios/i.test(ua)
        ? "Chrome"
        : /firefox|fxios/i.test(ua)
          ? "Firefox"
          : /safari/i.test(ua)
            ? "Safari"
            : "Unknown browser";

  const os = /iphone|ipad|ipod/i.test(ua)
    ? "iPhone or iPad"
    : /android/i.test(ua)
      ? "Android"
      : /mac os x|macintosh/i.test(ua)
        ? "Mac"
        : /windows/i.test(ua)
          ? "Windows"
          : /linux/i.test(ua)
            ? "Linux"
            : "Unknown device";

  return { browser, os };
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
