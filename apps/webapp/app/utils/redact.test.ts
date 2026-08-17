/**
 * Redaction of log-bound values.
 *
 * `parseData` puts the whole submitted payload into `ShelfError.additionalData`
 * on a validation failure, and the logger emits `additionalData` verbatim. On
 * the password-reset form that payload is `{ email, otp, password,
 * confirmPassword }` — so mistyping the confirmation logged a valid OTP and the
 * user's chosen password in plaintext.
 *
 * detail.dev finding D042 (reported for one `additionalData` site; `parseData`
 * is the generic sink behind it).
 *
 * @see {@link file://./redact.ts}
 */

import { describe, expect, it } from "vitest";

import { REDACTED, redactSensitive } from "./redact";

// @vitest-environment node

describe("redactSensitive", () => {
  it("redacts the password-reset payload that caused this", () => {
    expect(
      redactSensitive({
        email: "user@example.com",
        otp: "123456",
        password: "hunter2",
        confirmPassword: "hunter2",
      })
    ).toEqual({
      email: "user@example.com",
      otp: REDACTED,
      password: REDACTED,
      confirmPassword: REDACTED,
    });
  });

  it("keeps non-sensitive fields, which are the point of logging at all", () => {
    expect(redactSensitive({ email: "a@b.c", name: "Ada", count: 3 })).toEqual({
      email: "a@b.c",
      name: "Ada",
      count: 3,
    });
  });

  it.each([
    "password",
    "newPassword",
    "confirmPassword",
    "currentPassword",
    "password_confirmation",
    "otp",
    "token",
    "refreshToken",
    "accessToken",
    "apiKey",
    "api_key",
    "clientSecret",
    "authorization",
    "sessionId",
    "privateKey",
  ])("redacts %s", (key) => {
    expect(redactSensitive({ [key]: "sensitive" })[key]).toBe(REDACTED);
  });

  it("does not mutate the input — callers still need the real values", () => {
    // A validation failure still has to tell the user which field was wrong.
    const input = { otp: "123456", email: "a@b.c" };

    redactSensitive(input);

    expect(input.otp).toBe("123456");
  });

  it("walks nested objects and arrays", () => {
    expect(
      redactSensitive({
        user: { email: "a@b.c", password: "hunter2" },
        attempts: [{ otp: "111111" }, { otp: "222222" }],
      })
    ).toEqual({
      user: { email: "a@b.c", password: REDACTED },
      attempts: [{ otp: REDACTED }, { otp: REDACTED }],
    });
  });

  it("passes primitives and null through untouched", () => {
    expect(redactSensitive("plain")).toBe("plain");
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it("leaves non-plain objects alone rather than flattening them", () => {
    // Spreading a Date into a plain object would turn it into `{}` and lose
    // the value entirely — worse than not redacting it.
    const date = new Date("2026-01-01");

    expect(redactSensitive({ when: date }).when).toBe(date);
  });

  it("terminates on deeply nested input instead of recursing forever", () => {
    let deep: Record<string, unknown> = { password: "hunter2" };
    for (let i = 0; i < 50; i++) {
      deep = { nested: deep };
    }

    expect(() => redactSensitive(deep)).not.toThrow();
  });
});
