/**
 * Invitation Message Validation and Sanitization
 *
 * This module provides security-focused validation and sanitization
 * for workspace invitation messages to prevent XSS, phishing, and spam.
 */

/** Maximum allowed characters for invitation messages */
export const INVITE_MESSAGE_MAX_LENGTH = 1000;

/**
 * Patterns that may indicate phishing attempts
 * These are blocked to protect users from social engineering
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
 * Patterns that may indicate spam or malicious URLs
 * Blocks common URL patterns to prevent link injection
 */
const SUSPICIOUS_URL_PATTERNS = [
  /https?:\/\/[^\s]+/gi, // Any HTTP(S) URL
  /www\.[^\s]+\.[a-z]{2,}/gi, // www.example.com
  /[^\s]+\.(com|org|net|io|co)\b/gi, // example.com
];

/**
 * Validates an invitation message for length and security concerns
 *
 * @param message - The invitation message to validate
 * @returns Object with isValid flag and optional error message
 */
export function validateInvitationMessage(message: string): {
  isValid: boolean;
  error?: string;
} {
  // Null or undefined check
  if (!message) {
    return { isValid: true }; // Message is optional
  }

  // Type check
  if (typeof message !== "string") {
    return {
      isValid: false,
      error: "Message must be a string",
    };
  }

  // Trim whitespace for validation
  const trimmedMessage = message.trim();

  // Empty message check (only whitespace)
  if (trimmedMessage.length === 0) {
    return {
      isValid: false,
      error: "Message cannot be empty or contain only whitespace",
    };
  }

  // Length check
  if (message.length > INVITE_MESSAGE_MAX_LENGTH) {
    return {
      isValid: false,
      error: `Message must not exceed ${INVITE_MESSAGE_MAX_LENGTH} characters`,
    };
  }

  // Check for phishing patterns
  for (const pattern of PHISHING_PATTERNS) {
    if (pattern.test(message)) {
      return {
        isValid: false,
        error:
          "Message contains suspicious phrases that may indicate phishing. Please rephrase your message.",
      };
    }
  }

  // Check for suspicious URLs
  for (const pattern of SUSPICIOUS_URL_PATTERNS) {
    if (pattern.test(message)) {
      return {
        isValid: false,
        error:
          "Messages cannot contain URLs or links. Please remove any links from your message.",
      };
    }
  }

  return { isValid: true };
}

/**
 * Sanitizes an invitation message by removing/escaping potentially dangerous content
 *
 * This function:
 * - Removes HTML tags
 * - Escapes HTML entities
 * - Normalizes whitespace
 * - Truncates to maximum length
 *
 * @param message - The raw message to sanitize
 * @returns Sanitized message safe for storage and display
 */
export function sanitizeInvitationMessage(message: string): string {
  if (!message || typeof message !== "string") {
    return "";
  }

  // Remove HTML tags
  let sanitized = message.replace(/<[^>]*>/g, "");

  // Escape HTML entities to prevent XSS
  sanitized = sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");

  // Normalize whitespace (preserve single line breaks, remove excessive spacing)
  sanitized = sanitized.replace(/\r\n/g, "\n"); // Normalize line endings
  sanitized = sanitized.replace(/\r/g, "\n"); // Normalize old Mac line endings
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n"); // Max 2 consecutive line breaks
  sanitized = sanitized.replace(/[ \t]+/g, " "); // Normalize spaces and tabs
  sanitized = sanitized.trim();

  // Truncate to maximum length
  if (sanitized.length > INVITE_MESSAGE_MAX_LENGTH) {
    sanitized = sanitized.substring(0, INVITE_MESSAGE_MAX_LENGTH);
  }

  return sanitized;
}

/**
 * Combined validation and sanitization function
 * Use this in your service layer for processing invitation messages
 *
 * @param message - Raw message from user input
 * @returns Object with sanitized message or error
 */
export function processInvitationMessage(message: string | null | undefined): {
  success: boolean;
  message?: string | null;
  error?: string;
} {
  // Allow empty/null messages (field is optional)
  if (!message || message.trim().length === 0) {
    return { success: true, message: null };
  }

  // Validate first
  const validation = validateInvitationMessage(message);
  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  // Sanitize
  const sanitized = sanitizeInvitationMessage(message);

  // Double-check sanitized message isn't empty
  if (sanitized.trim().length === 0) {
    return {
      success: false,
      error: "Message cannot be empty after processing",
    };
  }

  return {
    success: true,
    message: sanitized,
  };
}
