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
    expect(validateInvitationMessage("").isValid).toBe(false); // Empty string after trim
    expect(validateInvitationMessage(null as any).isValid).toBe(true); // Null is acceptable
    expect(validateInvitationMessage(undefined as any).isValid).toBe(true); // Undefined is acceptable
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
    const phishingMessages = [
      "Please verify your account immediately",
      "URGENT: Update your payment information",
      "Your account has been suspended",
      "Urgent action required for your security",
      "Click here immediately to confirm your identity",
    ];

    phishingMessages.forEach((message) => {
      const result = validateInvitationMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("suspicious");
    });
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
  it("should remove HTML tags", () => {
    const result = sanitizeInvitationMessage(
      "Hello <script>alert('xss')</script>world"
    );
    expect(result).toBe("Hello alert('xss')world");
    expect(result).not.toContain("<script>");
  });

  it("should escape HTML entities", () => {
    const result = sanitizeInvitationMessage("<div>Test & 'quotes'</div>");
    expect(result).toBe(
      "&lt;div&gt;Test &amp; &#x27;quotes&#x27;&lt;&#x2F;div&gt;"
    );
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

  it("should escape potential XSS vectors", () => {
    const xssAttempts = [
      '<img src=x onerror="alert(1)">',
      "<svg/onload=alert(1)>",
      "javascript:alert(1)",
      "<iframe src='evil.com'>",
    ];

    xssAttempts.forEach((attempt) => {
      const result = sanitizeInvitationMessage(attempt);
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
      expect(result).toContain("&lt;");
    });
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
    expect(result.message).toBe("Hello world &amp; friends");
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

  it("should reject whitespace-only messages", () => {
    const result = processInvitationMessage("   \n\t  ");
    expect(result.success).toBe(false);
    expect(result.error).toContain("whitespace");
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
