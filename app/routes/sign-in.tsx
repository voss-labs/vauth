import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { authClient } from "~/lib/auth-client";
import { ALLOWED_EMAIL_DOMAIN } from "~/lib/config";
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

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

type Step = "email" | "code";

export default function SignIn() {
  const [params] = useSearchParams();
  const callbackURL = params.get("redirect") ?? "/";

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

    if (!address.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
      setError(`Use your college email — it must end in @${ALLOWED_EMAIL_DOMAIN}.`);
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
                placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
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
