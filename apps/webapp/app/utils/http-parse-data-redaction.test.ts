/**
 * `parseData` must not echo secrets into the error it throws.
 *
 * On a validation failure it places the ENTIRE submitted payload into
 * `additionalData`, and the logger writes `additionalData` verbatim. The
 * password-reset form submits `{ email, otp, password, confirmPassword }`, so
 * the most ordinary user mistake — mistyping the confirmation — wrote a live
 * OTP and the user's chosen password to the server log in plaintext.
 *
 * `shouldBeCaptured: false` does not help: it suppresses the Sentry hop, not
 * the log line. The password-reset route passes exactly that option, which is
 * why the leak survived review.
 *
 * detail.dev finding D042.
 *
 * @see {@link file://./http.server.ts} `parseData`
 * @see {@link file://./redact.ts}
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REDACTED } from "./redact";

// @vitest-environment node

/** Mirrors the real `OtpSchema` on the password-reset route. */
const OtpSchema = z.object({
  otp: z.string().min(6, "OTP is required."),
  email: z.string(),
  password: z.string().min(8, "Password is too short."),
  confirmPassword: z.string().min(8, "Password is too short."),
});

/** The payload a user submits when they mistype the confirmation. */
function passwordResetPayload() {
  return new URLSearchParams({
    otp: "123456",
    email: "user@example.com",
    // Under the 8-char minimum so validation actually fails, and distinctive
    // so a substring check cannot collide with the validation MESSAGE (which
    // itself contains the word "short").
    password: "Zx9Qw",
    confirmPassword: "Zx9Qw",
  });
}

describe("parseData redaction", () => {
  it("does not put the OTP or password in additionalData", async () => {
    const { parseData } = await import("./http.server");

    let thrown: unknown;
    try {
      parseData(passwordResetPayload(), OtpSchema, {
        // Exactly what the real route passes — and exactly why this was missed.
        shouldBeCaptured: false,
      });
    } catch (cause) {
      thrown = cause;
    }

    const { additionalData } = thrown as {
      additionalData: { data: Record<string, unknown> };
    };

    expect(additionalData.data.otp).toBe(REDACTED);
    expect(additionalData.data.password).toBe(REDACTED);
    expect(additionalData.data.confirmPassword).toBe(REDACTED);
  });

  it("keeps the non-sensitive fields that make the log useful", async () => {
    const { parseData } = await import("./http.server");

    let thrown: unknown;
    try {
      parseData(passwordResetPayload(), OtpSchema, {});
    } catch (cause) {
      thrown = cause;
    }

    const { additionalData } = thrown as {
      additionalData: { data: Record<string, unknown> };
    };

    expect(additionalData.data.email).toBe("user@example.com");
  });

  it("leaves no secret anywhere in the serialized error", async () => {
    // The assertion that actually matters: whatever the shape, the plaintext
    // secret must not survive into anything a logger would write.
    const { parseData } = await import("./http.server");

    let thrown: unknown;
    try {
      parseData(passwordResetPayload(), OtpSchema, {
        shouldBeCaptured: false,
      });
    } catch (cause) {
      thrown = cause;
    }

    const serialized = JSON.stringify(
      (thrown as { additionalData: unknown }).additionalData
    );

    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("Zx9Qw");
  });

  it("still reports which field failed validation", async () => {
    // Redaction must not cost the user a usable error.
    const { parseData } = await import("./http.server");

    let thrown: unknown;
    try {
      parseData(passwordResetPayload(), OtpSchema, {});
    } catch (cause) {
      thrown = cause;
    }

    const { validationErrors } = (
      thrown as {
        additionalData: {
          validationErrors: Record<string, { message: string }>;
        };
      }
    ).additionalData;

    expect(validationErrors.password.message).toBe("Password is too short.");
  });
});

describe("logger serialization", () => {
  it("redacts a hand-written additionalData that carries a secret", async () => {
    // Defence in depth for the sites parseData does not build. `serializeError`
    // is the single point where a ShelfError becomes the object pino writes, so
    // redacting there makes a new `additionalData` safe by default.
    const { serializeError } = await import("./logger");
    const { ShelfError } = await import("./error");

    const serialized = serializeError(
      new ShelfError({
        cause: null,
        message: "Invalid or expired verification code",
        additionalData: { email: "user@example.com", otp: "123456" },
        label: "Auth",
        shouldBeCaptured: false,
      })
    ) as unknown as { additionalData: Record<string, unknown> };

    expect(serialized.additionalData.otp).toBe(REDACTED);
    // The useful context survives — redaction must not cost us debuggability.
    expect(serialized.additionalData.email).toBe("user@example.com");
  });

  it("redacts through a nested cause chain", async () => {
    const { serializeError } = await import("./logger");
    const { ShelfError } = await import("./error");

    const inner = new ShelfError({
      cause: null,
      message: "inner",
      additionalData: { password: "hunter2" },
      label: "Auth",
    });

    const serialized = JSON.stringify(
      serializeError(
        new ShelfError({ cause: inner, message: "outer", label: "Auth" })
      )
    );

    expect(serialized).not.toContain("hunter2");
  });
});
