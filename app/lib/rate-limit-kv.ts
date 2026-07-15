// Durable rate-limit storage backed by Workers KV.
//
// Wired through `rateLimit.customStorage`, NOT the global `secondaryStorage`.
// Setting secondaryStorage would silently move SESSIONS into KV too — which is
// eventually-consistent and the wrong substrate for auth sessions. customStorage
// is scoped to rate limiting only.
//
// KV is resolved LAZILY inside each method, never at construction. That keeps
// buildAuth() synchronous (the auth Proxy depends on it) and keeps this file
// loadable under plain Node — `cloudflare:workers` is a Workers-only module, and
// the @better-auth schema CLI loads the auth config under Node. Under Node the
// methods simply never run (no requests), so the dynamic import is never reached.

type RateLimit = { key: string; count: number; lastRequest: number };
type StoredEntry = { count: number; resetAt: number };

// KV's expirationTtl floor is 60 seconds; a shorter value throws on put().
const KV_MIN_TTL = 60;

let kvPromise: Promise<KVNamespace | undefined> | undefined;

function getKV(): Promise<KVNamespace | undefined> {
  return (kvPromise ??= import("cloudflare:workers")
    .then((m) => (m.env as unknown as Env | undefined)?.RATE_LIMIT_KV)
    .catch(() => undefined));
}

export function kvRateLimitStorage() {
  return {
    async get(key: string): Promise<RateLimit | null> {
      const kv = await getKV();
      if (!kv) return null;
      const raw = await kv.get(key);
      if (!raw) return null;
      const d = JSON.parse(raw) as StoredEntry;
      return { key, count: d.count, lastRequest: d.resetAt };
    },

    async set(key: string, value: RateLimit): Promise<void> {
      const kv = await getKV();
      if (!kv) return;
      await kv.put(
        key,
        JSON.stringify({
          count: value.count,
          resetAt: Date.now() + KV_MIN_TTL * 1000,
        } satisfies StoredEntry),
        { expirationTtl: KV_MIN_TTL }
      );
    },

    // Preferred atomic-ish path. Fixed window: the reset time is set when the
    // window first opens and never slides on subsequent hits.
    async consume(
      key: string,
      rule: { window: number; max: number }
    ): Promise<{ allowed: boolean; retryAfter: number | null }> {
      const kv = await getKV();
      // No binding (only reachable under Node, where no request is served): the
      // in-memory limiter is not in play here, so allow rather than crash.
      if (!kv) return { allowed: true, retryAfter: null };

      const now = Date.now();
      const raw = await kv.get(key);
      const data = raw ? (JSON.parse(raw) as StoredEntry) : null;

      if (!data || now >= data.resetAt) {
        await kv.put(
          key,
          JSON.stringify({ count: 1, resetAt: now + rule.window * 1000 }),
          { expirationTtl: Math.max(rule.window, KV_MIN_TTL) }
        );
        return { allowed: true, retryAfter: null };
      }

      if (data.count >= rule.max) {
        return {
          allowed: false,
          retryAfter: Math.ceil((data.resetAt - now) / 1000),
        };
      }

      await kv.put(
        key,
        JSON.stringify({ count: data.count + 1, resetAt: data.resetAt }),
        { expirationTtl: Math.max(Math.ceil((data.resetAt - now) / 1000), KV_MIN_TTL) }
      );
      return { allowed: true, retryAfter: null };
    },
  };
}
