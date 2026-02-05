import { describe, it, expect } from "vitest";
import {
  validateInvitationMessage,
  sanitizeInvitationMessage,
  processInvitationMessage,
  INVITE_MESSAGE_MAX_LENGTH,
} from "./message-validator.server";

describe("validateInvitationMessage", () => {
  it("should accept valid messages", () => {
    const result = validateInvitationMessage(
      "Welcome to our team! We're excited to have you."
    );
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should accept messages with line breaks", () => {
    const result = validateInvitationMessage(
      "Welcome to our team!\n\nWe're excited to have you."
    );
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should accept empty or undefined messages (optional field)", () => {
    // Empty string is falsy, so it passes the !message check and returns valid
    expect(validateInvitationMessage("").isValid).toBe(true);
    expect(validateInvitationMessage(null as any).isValid).toBe(true);
    expect(validateInvitationMessage(undefined as any).isValid).toBe(true);
  });

  it("should reject messages that are only whitespace", () => {
    const result = validateInvitationMessage("   \n\t  ");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("whitespace");
  });

  it("should reject messages exceeding max length", () => {
    const longMessage = "a".repeat(INVITE_MESSAGE_MAX_LENGTH + 1);
    const result = validateInvitationMessage(longMessage);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("1000 characters");
  });

  it("should reject messages with phishing patterns", () => {
    // Messages that match the defined phishing patterns
    const phishingMessages = [
      "Please verify your account immediately", // matches verify.*account
      "URGENT: Update your payment information", // matches update.*payment
      "Urgent action required for your security", // matches urgent.*action.*required
      "Click here immediately to confirm your identity", // matches confirm.*identity
    ];

    phishingMessages.forEach((message) => {
      const result = validateInvitationMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("suspicious");
    });
  });

  it("should accept messages that don't match phishing patterns", () => {
    // "Your account has been suspended" has words in wrong order for suspended.*account
    const result = validateInvitationMessage("Your account has been suspended");
    expect(result.isValid).toBe(true);
  });

  it("should reject messages with URLs", () => {
    const messagesWithUrls = [
      "Check out https://evil.com",
      "Visit www.phishing-site.com for details",
      "Go to example.com to see more",
      "Click http://malicious.io/hack",
    ];

    messagesWithUrls.forEach((message) => {
      const result = validateInvitationMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("URL");
    });
  });

  it("should reject non-string messages", () => {
    const result = validateInvitationMessage(123 as any);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("string");
  });
});

describe("sanitizeInvitationMessage", () => {
  it("should remove HTML tags and preserve remaining text", () => {
    const result = sanitizeInvitationMessage(
      "Hello <script>alert('xss')</script>world"
    );
    // Tags are removed, text content is preserved as-is
    expect(result).toBe("Hello alert('xss')world");
    expect(result).not.toContain("<script>");
  });

  it("should strip tags but preserve special characters as-is", () => {
    // Tags are removed; &, quotes, etc. are NOT entity-encoded
    // because React handles escaping at render time
    const result = sanitizeInvitationMessage("<div>Test & 'quotes'</div>");
    expect(result).toBe("Test & 'quotes'");
  });

  it("should preserve line breaks but normalize excessive ones", () => {
    const result = sanitizeInvitationMessage(
      "Line 1\n\n\n\n\nLine 2\n\n\n\nLine 3"
    );
    expect(result).toBe("Line 1\n\nLine 2\n\nLine 3");
  });

  it("should normalize whitespace", () => {
    const result = sanitizeInvitationMessage("Hello    world  \t\t  test");
    expect(result).toBe("Hello world test");
  });

  it("should trim leading and trailing whitespace", () => {
    const result = sanitizeInvitationMessage("  Hello world  \n\n");
    expect(result).toBe("Hello world");
  });

  it("should truncate messages exceeding max length", () => {
    const longMessage = "a".repeat(INVITE_MESSAGE_MAX_LENGTH + 100);
    const result = sanitizeInvitationMessage(longMessage);
    expect(result.length).toBe(INVITE_MESSAGE_MAX_LENGTH);
  });

  it("should handle empty or null input", () => {
    expect(sanitizeInvitationMessage("")).toBe("");
    expect(sanitizeInvitationMessage(null as any)).toBe("");
    expect(sanitizeInvitationMessage(undefined as any)).toBe("");
  });

  it("should neutralize potential XSS vectors by stripping tags", () => {
    // Self-contained tags are completely removed
    expect(sanitizeInvitationMessage('<img src=x onerror="alert(1)">')).toBe(
      ""
    );
    expect(sanitizeInvitationMessage("<svg/onload=alert(1)>")).toBe("");
    expect(sanitizeInvitationMessage("<iframe src='evil.com'>")).toBe("");
    // Non-tag content is preserved as-is
    expect(sanitizeInvitationMessage("javascript:alert(1)")).toBe(
      "javascript:alert(1)"
    );
    // Mixed content: tags removed, text preserved
    expect(sanitizeInvitationMessage("Click <a href='evil'>here</a>")).toBe(
      "Click here"
    );
  });
});

describe("processInvitationMessage", () => {
  it("should successfully process valid messages", () => {
    const result = processInvitationMessage("Welcome to our team!");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Welcome to our team!");
    expect(result.error).toBeUndefined();
  });

  it("should allow null or undefined messages (optional field)", () => {
    const result1 = processInvitationMessage(null);
    expect(result1.success).toBe(true);
    expect(result1.message).toBeNull();

    const result2 = processInvitationMessage(undefined);
    expect(result2.success).toBe(true);
    expect(result2.message).toBeNull();

    const result3 = processInvitationMessage("");
    expect(result3.success).toBe(true);
    expect(result3.message).toBeNull();
  });

  it("should return sanitized message for valid input", () => {
    const result = processInvitationMessage("Hello <b>world</b> & friends");
    expect(result.success).toBe(true);
    // Tags stripped, special chars preserved (React escapes at render time)
    expect(result.message).toBe("Hello world & friends");
  });

  it("should return error for phishing attempts", () => {
    const result = processInvitationMessage("Verify your account now!");
    expect(result.success).toBe(false);
    expect(result.error).toContain("suspicious");
  });

  it("should return error for messages with URLs", () => {
    const result = processInvitationMessage("Check out https://example.com");
    expect(result.success).toBe(false);
    expect(result.error).toContain("URL");
  });

  it("should return error for messages exceeding max length", () => {
    const longMessage = "a".repeat(INVITE_MESSAGE_MAX_LENGTH + 1);
    const result = processInvitationMessage(longMessage);
    expect(result.success).toBe(false);
    expect(result.error).toContain("1000 characters");
  });

  it("should treat whitespace-only messages as empty (optional field)", () => {
    // Whitespace-only message is treated as empty, returning null
    const result = processInvitationMessage("   \n\t  ");
    expect(result.success).toBe(true);
    expect(result.message).toBeNull();
  });

  it("should preserve multi-line messages", () => {
    const multiline = "Welcome!\n\nLooking forward to working with you.";
    const result = processInvitationMessage(multiline);
    expect(result.success).toBe(true);
    expect(result.message).toContain("\n");
  });

  it("should handle international characters", () => {
    const international = "Willkommen! 欢迎! Bienvenue! Добро пожаловать!";
    const result = processInvitationMessage(international);
    expect(result.success).toBe(true);
    expect(result.message).toBe(international);
  });

  it("should handle edge case: message exactly at max length", () => {
    const exactLength = "a".repeat(INVITE_MESSAGE_MAX_LENGTH);
    const result = processInvitationMessage(exactLength);
    expect(result.success).toBe(true);
    expect(result.message?.length).toBe(INVITE_MESSAGE_MAX_LENGTH);
  });
});
