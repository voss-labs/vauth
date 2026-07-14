import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { auth } from "~/lib/auth.server";
import { requestState, type RequestState } from "~/lib/exec-context";

// better-auth catches every sendVerificationOTP error and returns success anyway.
// Under passwordless that is a silent, permanent lockout — "check your inbox",
// no mail, no error, and no password to fall back on. sendOTP records the failure
// on the request store; here we turn it back into a 500 the client can act on.
async function handle(request: Request) {
  const state: RequestState = {};

  const response = await requestState.run(state, () => auth.handler(request));

  if (state.emailFailed) {
    console.error("OTP delivery failed:", state.emailFailed);
    return Response.json(
      {
        message:
          "We could not send your verification code. Please try again in a moment.",
      },
      { status: 500 }
    );
  }

  return response;
}

export function loader({ request }: LoaderFunctionArgs) {
  return handle(request);
}

export function action({ request }: ActionFunctionArgs) {
  return handle(request);
}
