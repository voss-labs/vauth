import { redirect } from "react-router";
import { auth } from "~/lib/auth.server";
import type { Route } from "./+types/index";

// The root is a router, not a page. Signed in → your account; signed out → the
// front door. An identity provider has no landing page to speak of.
export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  throw redirect(session ? "/account" : "/sign-in");
}
