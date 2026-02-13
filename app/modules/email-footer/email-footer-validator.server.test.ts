import { describe, expect, it } from "vitest";
import {
  EMAIL_FOOTER_MAX_LENGTH,
  processEmailFooter,
  sanitizeEmailFooter,
  validateEmailFooter,
} from "./email-footer-validator.server";

describe("validateEmailFooter", () => {
  it("accepts plain text", () => {
    const result = validateEmailFooter("Contact us for support.");
    expect(result.isValid).toBe(true);
  });

  it("accepts email addresses", () => {
    const result = validateEmailFooter("Contact: admin@company.com");
    expect(result.isValid).toBe(true);
  });

  it("accepts phone numbers", () => {
    const result = validateEmailFooter("Call us: +1 (555) 123-4567");
    expect(result.isValid).toBe(true);
  });

  it("accepts null/empty messages", () => {
    expect(validateEmailFooter("").isValid).toBe(true);
  });

  it("blocks HTTP URLs and shows the detected link", () => {
    const result = validateEmailFooter("Visit https://evil.com for more");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("URLs");
    expect(result.error).toContain("https://evil.com");
  });

  it("blocks www URLs and shows the detected link", () => {
    const result = validateEmailFooter("Visit www.evil.com for more");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("URLs");
    expect(result.error).toContain("www.evil.com");
  });

  it("blocks bare domain URLs and shows the detected link", () => {
    const result = validateEmailFooter("Visit evil.com for more info");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("URLs");
    expect(result.error).toContain("evil.com");
  });

  it.each([
    "evil.dev",
    "evil.app",
    "evil.xyz",
    "evil.info",
    "evil.ai",
    "evil.site",
    "evil.cloud",
    "evil.tech",
    "evil.store",
    "evil.online",
    "evil.uk",
    "evil.de",
    "evil.tv",
    "evil.gg",
    "evil.ly",
    "evil.to",
  ])("blocks bare domain with TLD: %s", (domain) => {
    const result = validateEmailFooter(`Visit ${domain} for more`);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("URLs");
    expect(result.error).toContain(domain);
  });

  it("blocks phishing patterns", () => {
    const result = validateEmailFooter("Please verify your account now");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("phishing");
  });

  it("enforces max length", () => {
    const longMessage = "a".repeat(EMAIL_FOOTER_MAX_LENGTH + 1);
    const result = validateEmailFooter(longMessage);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("500");
  });

  it("accepts messages at exactly max length", () => {
    const message = "a".repeat(EMAIL_FOOTER_MAX_LENGTH);
    const result = validateEmailFooter(message);
    expect(result.isValid).toBe(true);
  });

  it("accepts multi-line content with email and phone", () => {
    const result = validateEmailFooter(
      "ACME Corp\nEmail: info@acme.com\nPhone: 555-0100"
    );
    expect(result.isValid).toBe(true);
  });
});

describe("sanitizeEmailFooter", () => {
  it("strips HTML tags", () => {
    const result = sanitizeEmailFooter("<b>Bold</b> text");
    expect(result).toBe("Bold text");
  });

  it("normalizes whitespace", () => {
    const result = sanitizeEmailFooter("too   many    spaces");
    expect(result).toBe("too many spaces");
  });

  it("limits consecutive line breaks", () => {
    const result = sanitizeEmailFooter("line1\n\n\n\n\nline2");
    expect(result).toBe("line1\n\nline2");
  });

  it("truncates to max length", () => {
    const input = "a".repeat(600);
    const result = sanitizeEmailFooter(input);
    expect(result.length).toBe(EMAIL_FOOTER_MAX_LENGTH);
  });

  it("returns empty string for null input", () => {
    expect(sanitizeEmailFooter(null as unknown as string)).toBe("");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeEmailFooter("  hello  ")).toBe("hello");
  });
});

describe("processEmailFooter", () => {
  it("returns null for empty input (clears footer)", () => {
    const result = processEmailFooter("");
    expect(result.success).toBe(true);
    expect(result.message).toBeNull();
  });

  it("returns null for null input", () => {
    const result = processEmailFooter(null);
    expect(result.success).toBe(true);
    expect(result.message).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    const result = processEmailFooter("   ");
    expect(result.success).toBe(true);
    expect(result.message).toBeNull();
  });

  it("returns sanitized message for valid input", () => {
    const result = processEmailFooter(
      "Contact: support@company.com\nPhone: 555-0100"
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe(
      "Contact: support@company.com\nPhone: 555-0100"
    );
  });

  it("returns error for invalid input", () => {
    const result = processEmailFooter("Visit https://evil.com");
    expect(result.success).toBe(false);
    expect(result.error).toContain("URLs");
  });

  it("sanitizes HTML before returning", () => {
    const result = processEmailFooter("<script>alert('xss')</script>Hello");
    expect(result.success).toBe(true);
    expect(result.message).toBe("alert('xss')Hello");
  });
});
