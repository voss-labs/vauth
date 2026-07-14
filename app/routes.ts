import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),

  // oauthProvider redirects here mid-authorization. Both paths are configured in
  // auth.server.ts as loginPage / consentPage — renaming either breaks the flow.
  route("sign-in", "routes/sign-in.tsx"),
  route("consent", "routes/consent.tsx"),

  route("account", "routes/account.tsx"),

  // The console. admin.tsx is the shell; children are nested, so their paths are
  // relative to /admin. Every loader and action re-checks the role server-side —
  // hiding a button is a UI convenience, never a permission.
  route("admin", "routes/admin.tsx", [
    index("routes/admin.users.tsx"),
    route("u/:id", "routes/admin.user.tsx"),
    route("audit", "routes/admin.audit.tsx"),
    route("clients", "routes/admin.clients.tsx"),
  ]),

  // better-auth mounts every endpoint inside auth.handler, including /oauth2/*.
  route("api/auth/*", "routes/api.auth.$.ts"),

  // RFC 8414 metadata lives at the origin root, outside the catch-all above.
  route(".well-known/*", "routes/well-known.ts"),
] satisfies RouteConfig;
