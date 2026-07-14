import { randomUUID, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";

import { sendOTP } from "~/lib/email.server";
import { isInstitutionalEmail } from "~/lib/config";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

function identifier(userId: string) {
  return `recovery-otp-${userId}`;
}

// Not routed through better-auth's emailOTP plugin on purpose. That path is
// gated to @vit.edu.in — which is exactly right for REGISTRATION and exactly
// wrong here, because the entire point of a recovery address is that it is NOT
// the institutional one the college will revoke.
export async function sendRecoveryCode(
  db: any,
  schema: any,
  userId: string,
  email: string,
) {
  const address = email.trim().toLowerCase();

  if (isInstitutionalEmail(address)) {
    throw new Error(
      "A recovery address must not be your college email — that is the address you are protecting against losing.",
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw new Error("That does not look like an email address.");
  }

  const existing = await db.query.verification.findFirst({
    where: eq(schema.verification.identifier, identifier(userId)),
  });

  if (existing) {
    const age = Date.now() - new Date(existing.createdAt).getTime();
    if (age < RESEND_COOLDOWN_MS) {
      throw new Error(
        `Wait ${Math.ceil((RESEND_COOLDOWN_MS - age) / 1000)}s before requesting another code.`,
      );
    }
    await db
      .delete(schema.verification)
      .where(eq(schema.verification.identifier, identifier(userId)));
  }

  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await db.insert(schema.verification).values({
    id: randomUUID(),
    identifier: identifier(userId),
    // The address rides along with the code so that verifying proves control of
    // THIS address, not merely knowledge of a code.
    value: `${otp}:${address}`,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await sendOTP({ email: address, otp, type: "email-verification" });
}

export async function confirmRecoveryCode(
  db: any,
  schema: any,
  userId: string,
  code: string,
) {
  const row = await db.query.verification.findFirst({
    where: and(
      eq(schema.verification.identifier, identifier(userId)),
      gt(schema.verification.expiresAt, new Date()),
    ),
  });

  if (!row) throw new Error("That code has expired. Request a new one.");

  const [expected, address] = String(row.value).split(":");

  // Constant-time. A fast reject on the first wrong digit leaks the code one
  // character at a time to anyone who can measure the response.
  const a = Buffer.from(expected.padEnd(6, "\0"));
  const b = Buffer.from(code.trim().padEnd(6, "\0"));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("That code is not right.");
  }

  await db
    .update(schema.user)
    .set({ recoveryEmail: address, recoveryEmailVerifiedAt: new Date() })
    .where(eq(schema.user.id, userId));

  await db
    .delete(schema.verification)
    .where(eq(schema.verification.identifier, identifier(userId)));

  return address;
}
