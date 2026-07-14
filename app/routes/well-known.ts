import type { LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth.server";

// The issuer is path-prefixed (https://host/api/auth), so OIDC discovery lives
// at {issuer}/.well-known/openid-configuration and the auth splat already serves
// it. What it does NOT serve is the RFC 8414 form — /.well-known/oauth-authorization-server/api/auth
// — which sits at the origin root, outside /api/auth/*. That is what this route
// forwards. Without it, any client that resolves metadata per RFC 8414 gets a 404.
export function loader({ request }: LoaderFunctionArgs) {
  return auth.handler(request);
}
