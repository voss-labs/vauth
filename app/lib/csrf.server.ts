import { PUBLIC_ORIGIN } from "~/lib/config";

/**
 * Every state-changing React Router action must call this first.
 *
 * Better Auth's origin check guards only its own /api/auth/* routes, not our
 * actions. Today a cross-site POST is stopped solely by the SameSite=Lax session
 * cookie not being sent — which works, but is invisible and load-bearing: the day
 * someone sets sameSite:"none" for cross-subdomain sessions, every action here
 * silently becomes CSRF-able (evil.com auto-POSTing to change a recovery email,
 * or to disable an account if the victim is an admin).
 *
 * An explicit same-origin assertion survives that change. It rejects any request
 * whose Origin (or Sec-Fetch-Site) says it came from another site.
 */
export function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  // Modern browsers send this and it is unforgeable by page script.
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return;
    throw new Response("Cross-site request rejected.", { status: 403 });
  }

  // Fallback for anything that doesn't send Sec-Fetch-Site: compare Origin.
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser / same-origin navigations omit it
  const allowed = new Set([PUBLIC_ORIGIN, "http://localhost:5173"]);
  if (!allowed.has(origin)) {
    throw new Response("Cross-site request rejected.", { status: 403 });
  }
}
