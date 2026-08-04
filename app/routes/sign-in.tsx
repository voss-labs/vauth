import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import type { Route } from "./+types/sign-in";
import { authClient } from "~/lib/auth-client";
import {
  ALLOWED_EMAIL_DOMAINS_LABEL,
  isInstitutionalEmail,
} from "~/lib/config";
import { GithubIcon } from "~/components/github-icon";
import { VossMark } from "~/components/voss-mark";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";

export function meta() {
  return [
    { title: "Sign in — VOSS" },
    {
      name: "description",
      content: "Sign in to your VOSS account with your institutional email.",
    },
  ];
}

// Presence of both env vars is what tells auth.server.ts to register the
// provider. If we render the GitHub button unconditionally, clicking it when
// unconfigured redirects to better-auth's raw `/api/auth/error` page.
export async function loader() {
  return {
    githubEnabled: !!(
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ),
  };
}

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

// Errors surfaced from better-auth's OAuth callback via `errorCallbackURL`
// come back as `?error=github&error_code=...`. Rendered inline instead of
// dumping the user on the raw better-auth error page.
const GITHUB_ERROR_MESSAGES: Record<string, string> = {
  signup_disabled:
    "This GitHub account has not been linked yet. Sign in with your college email first, then link GitHub from your account page.",
  account_already_linked_to_different_user:
    "This GitHub account is already linked to a different VOSS user.",
};

function messageForGithubError(code: string | null): string {
  if (!code) return "Could not sign in with GitHub. Try the college email flow instead.";
  return (
    GITHUB_ERROR_MESSAGES[code] ??
    "Could not sign in with GitHub. Try the college email flow instead."
  );
}

type Step = "email" | "code";

export default function SignIn({ loaderData }: Route.ComponentProps) {
  const { githubEnabled } = loaderData;

  const [params] = useSearchParams();
  const callbackURL = params.get("redirect") ?? "/";
  const githubErrorCode =
    params.get("error") === "github" ? params.get("error_code") : null;

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const status = busy ? "busy" : error ? "error" : "idle";

  async function sendCode(address: string) {
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: address,
      type: "sign-in",
    });
    setBusy(false);

    if (error) {
      setError(error.message ?? "Something went wrong. Try again.");
      return false;
    }
    setCooldown(RESEND_SECONDS);
    return true;
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();

    if (!isInstitutionalEmail(address)) {
      setError(`Use a ${ALLOWED_EMAIL_DOMAINS_LABEL} address.`);
      emailRef.current?.focus();
      return;
    }

    setEmail(address);
    if (await sendCode(address)) setStep("code");
  }

  // Verify as soon as the sixth digit lands. Asking someone to type six digits
  // and then press a button is one interaction too many.
  async function verify(value: string) {
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.emailOtp({
      email,
      otp: value,
      fetchOptions: { onSuccess: () => window.location.assign(callbackURL) },
    });

    if (error) {
      setBusy(false);
      setCode("");
      setError(
        error.message ?? "That code is not right. Check it, or send a new one."
      );
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden p-6">
      <div className="voss-grid pointer-events-none absolute inset-0" />
      <div className="voss-glow pointer-events-none absolute inset-0" />

      <div className="voss-rise relative w-full max-w-sm">
        <VossMark status={status} className="mb-9" />

        {step === "email" ? (
          <form onSubmit={handleEmail} noValidate>
            <h1 className="text-2xl font-semibold tracking-tight">
              Sign in to VOSS
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              One account for VERP and vboard. We&rsquo;ll email you a code
              &mdash; there is no password to remember.
            </p>

            <div className="mt-7 space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                College email
              </label>
              <Input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="you@vit.edu.in"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={!!error}
                aria-describedby={error ? "form-error" : undefined}
                className="h-11 font-mono text-sm"
              />
            </div>

            <Message id="form-error" error={error} />

            <Button
              type="submit"
              disabled={busy || !email}
              className="mt-6 h-11 w-full font-medium"
            >
              {busy ? "Sending code…" : "Continue"}
            </Button>

            {/* The alumni entry. Hidden below the primary OTP flow because a
                current student should default to the college email, and only
                users who have linked GitHub while their email still worked can
                actually succeed here (socialProviders.github.disableSignUp is
                on). Sized as a modest secondary, not a full-width CTA, so it
                does not compete with Continue. Hidden entirely when the
                provider is not configured, since clicking then hits
                better-auth's raw error page. */}
            {githubEnabled && (
              <div className="border-border mt-8 border-t pt-5">
                <p className="text-muted-foreground/70 text-xs leading-relaxed">
                  Lost @vit.edu.in access after graduating? If you linked GitHub
                  while your college email still worked, sign in with it
                  instead.
                </p>
                {githubErrorCode !== null && (
                  <p
                    role="alert"
                    className="text-destructive mt-3 text-xs leading-relaxed"
                  >
                    {messageForGithubError(githubErrorCode)}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    authClient.signIn.social({
                      provider: "github",
                      callbackURL,
                      // Steer OAuth failures back to this page so we can render
                      // a real sentence instead of better-auth's `/error?...`.
                      errorCallbackURL: "/sign-in?error=github",
                    })
                  }
                  className="mt-3 h-9 gap-2 text-xs font-normal"
                >
                  <GithubIcon className="size-3.5" aria-hidden />
                  Sign in with GitHub
                </Button>
              </div>
            )}
          </form>
        ) : (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Check your inbox
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              We sent a {OTP_LENGTH}-digit code to{" "}
              <span className="text-foreground font-mono">{email}</span>. It
              expires in 10 minutes.
            </p>

            <div className="mt-7">
              <InputOTP
                maxLength={OTP_LENGTH}
                value={code}
                autoFocus
                disabled={busy}
                onChange={(v) => {
                  setCode(v);
                  if (error) setError(null);
                  if (v.length === OTP_LENGTH) verify(v);
                }}
              >
                <InputOTPGroup className="w-full justify-between gap-2">
                  {Array.from({ length: OTP_LENGTH }, (_, i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="h-13 flex-1 rounded-md font-mono text-lg"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Message id="otp-error" error={error} />

            <div className="text-muted-foreground mt-6 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
                className="hover:text-foreground underline-offset-4 transition-colors hover:underline"
              >
                Use a different email
              </button>

              <button
                type="button"
                disabled={cooldown > 0 || busy}
                onClick={() => sendCode(email)}
                className="hover:text-foreground underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </div>
        )}

        <p className="text-muted-foreground/70 mt-12 text-xs leading-relaxed">
          VOSS Labs &middot; Vidyalankar Institute of Technology
        </p>
      </div>
    </main>
  );
}

function Message({ id, error }: { id: string; error: string | null }) {
  if (!error) return null;
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="text-destructive mt-3 text-sm leading-relaxed"
    >
      {error}
    </p>
  );
}
