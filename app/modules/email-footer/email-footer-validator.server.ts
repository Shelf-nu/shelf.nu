/**
 * Email Footer Validation and Sanitization
 *
 * Provides security-focused validation and sanitization for custom
 * email footer messages. Allows email addresses and phone numbers
 * but blocks URLs, HTML, and phishing attempts.
 */

import { EMAIL_FOOTER_MAX_LENGTH } from "./constants";

export { EMAIL_FOOTER_MAX_LENGTH };

/**
 * Patterns that may indicate phishing attempts
 */
const PHISHING_PATTERNS = [
  /verify.*account/i,
  /update.*payment/i,
  /suspended.*account/i,
  /urgent.*action.*required/i,
  /confirm.*identity/i,
  /unusual.*activity/i,
  /security.*alert/i,
  /expir(e|ing|ed).*account/i,
  /click.*here.*immediately/i,
  /claim.*reward/i,
  /won.*prize/i,
  /reset.*password.*now/i,
];

/**
 * URL patterns to block. Uses negative lookbehind to allow email addresses
 * (e.g., user@domain.com) while still blocking bare domain URLs.
 */
const URL_PATTERNS = [
  /https?:\/\/[^\s]+/gi, // HTTP(S) URLs
  /www\.[^\s]+\.[a-z]{2,}/gi, // www.example.com
  /(?<![@\w])[a-z0-9-]+\.(com|org|net|io|co)(\/[^\s]*)?(?=\s|$)/gi, // bare domains, NOT emails
];

/**
 * Validates an email footer message for length and security concerns.
 * Allows email addresses and phone numbers.
 */
export function validateEmailFooter(message: string): {
  isValid: boolean;
  error?: string;
} {
  if (!message) {
    return { isValid: true };
  }

  if (typeof message !== "string") {
    return {
      isValid: false,
      error: "Footer must be a string",
    };
  }

  const trimmedMessage = message.trim();

  if (trimmedMessage.length === 0) {
    return { isValid: true }; // Empty footer is valid (clears the footer)
  }

  if (message.length > EMAIL_FOOTER_MAX_LENGTH) {
    return {
      isValid: false,
      error: `Footer must not exceed ${EMAIL_FOOTER_MAX_LENGTH} characters`,
    };
  }

  for (const pattern of PHISHING_PATTERNS) {
    if (pattern.test(message)) {
      return {
        isValid: false,
        error:
          "Footer contains suspicious phrases that may indicate phishing. Please rephrase your message.",
      };
    }
  }

  for (const pattern of URL_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    const match = pattern.exec(message);
    if (match) {
      return {
        isValid: false,
        error: `Footer cannot contain URLs or links ("${match[0]}"). Email addresses and phone numbers are permitted.`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Sanitizes an email footer message by removing potentially dangerous content.
 * Strips HTML tags, normalizes whitespace, and truncates to max length.
 */
export function sanitizeEmailFooter(message: string): string {
  if (!message || typeof message !== "string") {
    return "";
  }

  // Remove HTML tags
  let sanitized = message.replace(/<[^>]*>/g, "");

  // Note: We intentionally do NOT escape HTML entities here.
  // The message is rendered as a React text node in the email template,
  // which handles escaping automatically.

  // Normalize whitespace
  sanitized = sanitized.replace(/\r\n/g, "\n");
  sanitized = sanitized.replace(/\r/g, "\n");
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n");
  sanitized = sanitized.replace(/[ \t]+/g, " ");
  sanitized = sanitized.trim();

  if (sanitized.length > EMAIL_FOOTER_MAX_LENGTH) {
    sanitized = sanitized.substring(0, EMAIL_FOOTER_MAX_LENGTH);
  }

  return sanitized;
}

/**
 * Combined validation and sanitization for email footer messages.
 * Returns sanitized message on success, or null to clear the footer.
 */
export function processEmailFooter(message: string | null | undefined): {
  success: boolean;
  message?: string | null;
  error?: string;
} {
  if (!message || message.trim().length === 0) {
    return { success: true, message: null };
  }

  const validation = validateEmailFooter(message);
  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  const sanitized = sanitizeEmailFooter(message);

  if (sanitized.trim().length === 0) {
    return { success: true, message: null };
  }

  return {
    success: true,
    message: sanitized,
  };
}
