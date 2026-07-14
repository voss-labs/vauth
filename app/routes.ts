import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // better-auth mounts every endpoint inside auth.handler, including /oauth2/*.
  route("api/auth/*", "routes/api.auth.$.ts"),

  // RFC 8414 metadata lives at the origin root, outside the catch-all above.
  route(".well-known/*", "routes/well-known.ts"),

] satisfies RouteConfig;
