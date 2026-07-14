import { requestState } from "~/lib/exec-context";

type SendOTPArgs = {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
};

const RETRIES = 3;

// Most Resend failures are transient (429, 5xx). Retrying turns a silent lockout
// into a delivered code. 4xx other than 429 is our bug and will never succeed, so
// don't waste the user's time on it.
function isRetryable(status: number) {
  return status === 429 || status >= 500;
}

// The VOSS lockup is a heavy wordmark plus an orange square, so it reproduces
// exactly in CSS. That is deliberate: mail clients block remote images by default
// and Gmail strips SVG outright, so an <img> logo would render as a broken box for
// most students. A CSS wordmark always draws.
const INK = "#0A0A0A";
const ACCENT = "#FB7A3C";

function renderHTML(otp: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:40px 16px;background:#F5F5F4;font-family:Geist,Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:440px;margin:0 auto;background:#FFFFFF;border:1px solid #E7E5E4;border-radius:14px;">
      <tr><td style="padding:36px;">
        <span style="font-size:24px;font-weight:900;letter-spacing:-0.02em;color:${INK};">VOSS</span><span style="display:inline-block;width:9px;height:9px;background:${ACCENT};margin-left:5px;"></span>

        <div style="margin-top:32px;font-size:14px;color:#57534E;">Your verification code</div>
        <div style="margin-top:10px;font-size:36px;font-weight:800;letter-spacing:0.2em;color:${INK};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${otp}</div>

        <div style="margin-top:28px;font-size:13px;color:#57534E;line-height:1.65;">
          This code expires in 10 minutes. If you did not request it, ignore this email &mdash; nobody can sign in without it.
        </div>

        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E7E5E4;font-size:12px;color:#A8A29E;">
          VOSS Labs &middot; Vidyalankar Institute of Technology
        </div>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendOTP({ email, otp, type }: SendOTPArgs) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Dev-only convenience. In production a missing key must fail loudly rather
    // than print login codes into the Worker logs (observability is on) — a
    // contributor who deploys without RESEND_API_KEY would otherwise leak every
    // OTP. `import.meta.env.DEV` is compiled to false in the production build.
    if (import.meta.env.DEV) {
      console.log(`[otp:${type}] ${email} -> ${otp}`);
      return;
    }
    throw new Error(
      "RESEND_API_KEY is not set; refusing to send OTP in the clear.",
    );
  }

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // NOT no-reply. Passwordless means email is the only door into the
          // system, so a student who never receives their code will hit Reply —
          // and that has to reach a human, not a black hole.
          from: process.env.EMAIL_FROM ?? "VOSS Labs <accounts@vosslabs.org>",
          to: email,
          subject: `${otp} is your VOSS verification code`,
          // Plain text is the one that always renders: college mail clients block
          // images by default and some strip HTML entirely. The code must survive
          // both, so it lives in the text body too — never only in the HTML.
          text: `Your VOSS verification code is ${otp}. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.\n\nVOSS Labs`,
          html: renderHTML(otp),
        }),
      });

      if (res.ok) return;

      const body = await res.text();
      lastError = new Error(`Resend ${res.status}: ${body}`);
      if (!isRetryable(res.status)) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
    }
  }

  // better-auth swallows anything thrown from here, so record it on the request
  // for the auth route to find. Throw as well, so the failure is logged.
  const store = requestState.getStore();
  if (store && lastError) store.emailFailed = lastError;
  throw lastError ?? new Error("Failed to send verification email");
}
