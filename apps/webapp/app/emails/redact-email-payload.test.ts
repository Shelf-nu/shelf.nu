import { describe, expect, it } from "vitest";
import {
  redactEmailPayloadForLog,
  redactEmailTokens,
} from "./redact-email-payload";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6Imludml0ZS0xIn0.MZUOJFT_LRiZh0uK7V7pGtg1HhtkOmm_n8D0YXxDpIs";

describe("redactEmailTokens", () => {
  it("strips the token from an accept-invite link and keeps the rest", () => {
    const text = `Accept: https://app.shelf.nu/accept-invite/invite-1?token=${JWT}\n\nThanks`;

    expect(redactEmailTokens(text)).toBe(
      "Accept: https://app.shelf.nu/accept-invite/invite-1?token=REDACTED\n\nThanks"
    );
  });

  it("strips it from an HTML href, including an escaped ampersand", () => {
    const html = `<a href="https://app.shelf.nu/x?a=1&amp;token=${JWT}">Accept</a>`;

    expect(redactEmailTokens(html)).toBe(
      '<a href="https://app.shelf.nu/x?a=1&amp;token=REDACTED">Accept</a>'
    );
  });

  it("strips a bare JWT outside any link", () => {
    expect(redactEmailTokens(`Your token is ${JWT}.`)).toBe(
      "Your token is REDACTED."
    );
  });

  it("leaves a body with no token unchanged", () => {
    const text = "Your booking starts tomorrow at 09:00.";

    expect(redactEmailTokens(text)).toBe(text);
  });
});

describe("redactEmailPayloadForLog", () => {
  it("redacts both bodies and keeps recipient and subject", () => {
    const payload = {
      to: "invitee@example.com",
      subject: "You have been invited",
      text: `https://app.shelf.nu/accept-invite/1?token=${JWT}`,
      html: `<a href="https://app.shelf.nu/accept-invite/1?token=${JWT}">Go</a>`,
    };

    const logged = redactEmailPayloadForLog(payload);

    expect(logged).toEqual({
      to: "invitee@example.com",
      subject: "You have been invited",
      text: "https://app.shelf.nu/accept-invite/1?token=REDACTED",
      html: '<a href="https://app.shelf.nu/accept-invite/1?token=REDACTED">Go</a>',
    });
    expect(JSON.stringify(logged)).not.toContain(JWT);
  });

  it("does not add an html body the email did not have", () => {
    const logged = redactEmailPayloadForLog({
      to: "a@example.com",
      subject: "Hi",
      text: "Hello",
    });

    expect(logged).not.toHaveProperty("html");
  });
});
