import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped state. `emailFailed` exists because better-auth's
// runInBackgroundOrAwait() catches and logs every sendVerificationOTP error and
// then returns success anyway — see better-auth/dist/context/create-context.mjs.
// With passwordless, a swallowed send failure is a silent, permanent lockout:
// the student sees "check your inbox", no mail arrives, and there is no password
// to fall back on. So we record the failure here and let the auth route turn it
// back into a real error.
export type RequestState = { emailFailed?: Error };

export const requestState = new AsyncLocalStorage<RequestState>();
