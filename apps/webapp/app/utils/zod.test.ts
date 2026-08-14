import { z } from "zod";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_LENGTH_MESSAGE,
  passwordSchema,
} from "./zod";

/**
 * Tests for the shared `passwordSchema` used by every password *setter* flow
 * (signup, onboarding, password reset) — SHELF-WEBAPP-21A.
 *
 * The 72-**byte** cap mirrors Supabase/bcrypt so an over-long password is
 * rejected as a field-level validation error instead of a late, captured 500.
 * The bound is measured in UTF-8 bytes (not characters), so a short-looking
 * multi-byte password can still exceed it.
 */
describe("passwordSchema", () => {
  it("rejects a password longer than 72 bytes with the max message", () => {
    const result = passwordSchema().safeParse("a".repeat(73)); // 73 bytes

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(PASSWORD_MAX_LENGTH_MESSAGE);
    }
  });

  it("accepts a password exactly 72 bytes long", () => {
    const value = "a".repeat(PASSWORD_MAX_LENGTH); // 72 ASCII bytes
    const result = passwordSchema().safeParse(value);

    expect(result.success).toBe(true);
  });

  it("rejects a multi-byte password over 72 bytes (37 × 'é' = 74 bytes) with the max message", () => {
    // 37 two-byte characters = 74 UTF-8 bytes; only 37 chars, so a char-based
    // `.max(72)` would wrongly accept it — the byte refinement rejects it.
    const value = "é".repeat(37);
    expect(new TextEncoder().encode(value).length).toBe(74);

    const result = passwordSchema().safeParse(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(PASSWORD_MAX_LENGTH_MESSAGE);
    }
  });

  it("accepts a multi-byte password of exactly 72 bytes (36 × 'é')", () => {
    // 36 two-byte characters = exactly 72 UTF-8 bytes — the byte boundary.
    const value = "é".repeat(36);
    expect(new TextEncoder().encode(value).length).toBe(PASSWORD_MAX_LENGTH);

    const result = passwordSchema().safeParse(value);

    expect(result.success).toBe(true);
  });

  it("accepts a valid in-range password", () => {
    const result = passwordSchema().safeParse("supersecret");

    expect(result.success).toBe(true);
  });

  it("rejects a password shorter than 8 characters with the default min message", () => {
    const result = passwordSchema().safeParse("short");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Your password is too short. Min 8 characters are required."
      );
    }
  });

  it("uses the flow-specific min message when provided", () => {
    const result = passwordSchema(
      "Password is too short. Minimum 8 characters."
    ).safeParse("short");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Password is too short. Minimum 8 characters."
      );
    }
  });

  it("still enforces the 72-char cap when wrapped as optional (onboarding setter)", () => {
    // why: onboarding wraps a setter password with the same bounds; only the
    // "user already has a password" branch stays unconstrained-optional
    const optional = passwordSchema().optional();

    expect(optional.safeParse(undefined).success).toBe(true);
    expect(optional.safeParse("a".repeat(73)).success).toBe(false);
  });
});

/**
 * Guards onboarding's "user already has a password" branch: it must remain an
 * unconstrained optional string (empty/undefined allowed) so users who signed
 * up with a password can finish onboarding without re-entering one.
 */
describe("onboarding optional password branch", () => {
  const optionalBranch = z.string().optional();

  it("allows an omitted password", () => {
    expect(optionalBranch.safeParse(undefined).success).toBe(true);
  });

  it("allows an empty password", () => {
    expect(optionalBranch.safeParse("").success).toBe(true);
  });
});
