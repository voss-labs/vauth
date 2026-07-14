import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),

  // oauthProvider redirects here mid-authorization. Both paths are configured in
  // auth.server.ts as loginPage / consentPage — renaming either breaks the flow.
  route("sign-in", "routes/sign-in.tsx"),
  route("consent", "routes/consent.tsx"),

  route("account", "routes/account.tsx"),

  // The console. Not /admin: that is the first path every scanner probes, and
  // moving it cuts the log noise. It is NOT a lock — requireAdmin() is, it runs
  // server-side, and it runs again in every child loader and action.
  route("super-admin", "routes/super-admin.tsx", [
    index("routes/super-admin.users.tsx"),
    route("u/:id", "routes/super-admin.user.tsx"),
    route("audit", "routes/super-admin.audit.tsx"),
    route("clients", "routes/super-admin.clients.tsx"),
  ]),

  // better-auth mounts every endpoint inside auth.handler, including /oauth2/*.
  route("api/auth/*", "routes/api.auth.$.ts"),

  // RFC 8414 metadata lives at the origin root, outside the catch-all above.
  route(".well-known/*", "routes/well-known.ts"),
] satisfies RouteConfig;
