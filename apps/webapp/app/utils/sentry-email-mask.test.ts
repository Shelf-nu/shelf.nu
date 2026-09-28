/**
 * Tests for the email masking applied to every payload sent to Sentry.
 *
 * Covers the string masker (plain and percent-encoded addresses, strings that
 * only look like addresses, and hostile input that must scan in linear time)
 * and the payload walker (nested values, stack traces, shared references).
 *
 * @see {@link file://./sentry-email-mask.ts}
 */
import { describe, expect, it } from "vitest";

import {
  MASKED_EMAIL_LOCAL_PART,
  maskEmailAddresses,
  maskEmailsInSentryPayload,
} from "./sentry-email-mask";

describe("maskEmailAddresses", () => {
  it("replaces the local part and keeps the domain", () => {
    expect(maskEmailAddresses("Failed to sign in jane.doe@acme.com")).toBe(
      `Failed to sign in ${MASKED_EMAIL_LOCAL_PART}@acme.com`
    );
  });

  it("masks percent-encoded addresses inside a URL", () => {
    expect(
      maskEmailAddresses("/otp?email=jane%2Btag%40acme.com&mode=login")
    ).toBe(`/otp?email=${MASKED_EMAIL_LOCAL_PART}%40acme.com&mode=login`);
  });

  it("masks every address in the string, including multi-level domains", () => {
    expect(maskEmailAddresses("from a@acme.com to ops@mail.acme.co.uk")).toBe(
      `from ${MASKED_EMAIL_LOCAL_PART}@acme.com to ${MASKED_EMAIL_LOCAL_PART}@mail.acme.co.uk`
    );
  });

  it.each(["!", "$", "'", "*", "^", "`", "{", "|", "}", "~"])(
    "masks the whole local part when it contains %s",
    (character) => {
      expect(maskEmailAddresses(`sent to jo${character}hn@acme.com`)).toBe(
        `sent to ${MASKED_EMAIL_LOCAL_PART}@acme.com`
      );
    }
  );

  it("masks a percent-encoded local part that keeps an unreserved character", () => {
    // encodeURIComponent leaves ' ! * ~ as they are.
    expect(maskEmailAddresses("/join?email=o'connor%40acme.com")).toBe(
      `/join?email=${MASKED_EMAIL_LOCAL_PART}%40acme.com`
    );
  });

  it.each([
    ["an accented local part", "josé@example.com", "@example.com"],
    ["an accented domain", "jane@exämple.de", "@exämple.de"],
    ["a non-Latin address", "用户@例子.中国", "@例子.中国"],
  ])("masks %s", (_label, address, keptDomain) => {
    expect(maskEmailAddresses(`sent to ${address}`)).toBe(
      `sent to ${MASKED_EMAIL_LOCAL_PART}${keptDomain}`
    );
  });

  it("masks a percent-encoded internationalized address in a URL", () => {
    expect(
      maskEmailAddresses("/join?email=jos%C3%A9%40ex%C3%A4mple.com&x=1")
    ).toBe(`/join?email=${MASKED_EMAIL_LOCAL_PART}%40ex%C3%A4mple.com&x=1`);
  });

  it.each([
    ['"john..doe"@example.com', `${MASKED_EMAIL_LOCAL_PART}@example.com`],
    ['"john doe"@example.com', `${MASKED_EMAIL_LOCAL_PART}@example.com`],
  ])("masks the quoted local part in %s", (address, expected) => {
    expect(maskEmailAddresses(`sent to ${address}`)).toBe(
      `sent to ${expected}`
    );
  });

  it("masks an address inside a JSON string without touching its quotes", () => {
    expect(maskEmailAddresses('{"email":"jane@acme.com"}')).toBe(
      `{"email":"${MASKED_EMAIL_LOCAL_PART}@acme.com"}`
    );
  });

  it.each(["jane%40example%2Ecom", "jane%40example%2ecom"])(
    "masks %s, whose domain dot is percent-encoded",
    (text) => {
      expect(maskEmailAddresses(text)).toBe(
        `${MASKED_EMAIL_LOCAL_PART}${text.slice("jane".length)}`
      );
    }
  );

  it("masks every address in an encoded comma-separated list", () => {
    expect(maskEmailAddresses("to=a%40x.com%2Cb%40y.com")).toBe(
      `to=${MASKED_EMAIL_LOCAL_PART}%40x.com${MASKED_EMAIL_LOCAL_PART}%40y.com`
    );
  });

  it("keeps the page path when an address sits unencoded in a query", () => {
    expect(
      maskEmailAddresses("/forgot-password?email=jane@acme.com&next=/assets")
    ).toBe(
      `/forgot-password?email=${MASKED_EMAIL_LOCAL_PART}@acme.com&next=/assets`
    );
  });

  it.each([
    "@sentry/react-router",
    "/app/node_modules/.pnpm/@sentry+core@10.51.0/node_modules/@sentry/core",
    "follow @shelf on social",
    "postgres://user@localhost",
    "no address here",
  ])("leaves %s unchanged", (text) => {
    expect(maskEmailAddresses(text)).toBe(text);
  });

  // Each input is about 80,000 characters of address characters with no
  // address the masker can complete. An unbounded pattern rescans the rest of
  // the run from every start position and takes seconds to minutes on these;
  // the bounded one takes milliseconds. The limit is loose on purpose, so a
  // slow CI runner cannot make it flaky.
  it.each([
    ["repeated encoded separators", "a%40".repeat(20_000)],
    ["a long run ending in @", `${"a".repeat(80_000)}@`],
    ["a long run ending in %40", `${"a".repeat(80_000)}%40`],
    ["a long dotted run with no top-level domain", `a@${"a.".repeat(40_000)}1`],
    ["a long run of accented letters ending in @", `${"é".repeat(80_000)}@`],
    ["a long run of encoded dots", `a@${"a%2E".repeat(20_000)}1`],
    [
      "open quotes with no closing quote",
      `${`"${"a".repeat(300)}`.repeat(270)}@`,
    ],
  ])("scans %s in linear time", (_label, text) => {
    const started = performance.now();
    const masked = maskEmailAddresses(text);
    const elapsed = performance.now() - started;

    expect(masked).toBe(text);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("maskEmailsInSentryPayload", () => {
  /** An error event shaped like the SSO sign-in failure after `beforeSend`. */
  function ssoErrorEvent() {
    const frames = [
      {
        filename:
          "/app/node_modules/.pnpm/@sentry+core@10.51.0/node_modules/x.js",
        context_line: 'const SUPPORT = "support@shelf.nu";',
        in_app: false,
      },
    ];

    return {
      exception: {
        values: [
          {
            type: "ShelfError",
            value: "Failed to create SSO user: jane.doe@acme.com exists",
            stacktrace: { frames },
          },
        ],
      },
      extra: {
        email: "jane.doe@acme.com",
        domain: "acme.com",
        traceId: "trace-123",
        cause: { raw: JSON.stringify({ email: "jane.doe@acme.com" }) },
      },
      request: {
        url: "https://app.shelf.nu/otp?email=jane.doe%40acme.com&mode=login",
      },
      breadcrumbs: [
        {
          category: "console",
          message: "  <-- GET /otp?email=jane.doe%40acme.com&mode=login",
        },
      ],
      tags: { label: "Auth" },
      user: { id: "user-1" },
    };
  }

  it("removes the address from every part of an error event", () => {
    const masked = maskEmailsInSentryPayload(ssoErrorEvent());

    // Frame source lines are code, deliberately left alone (next test).
    const serialized = JSON.stringify(masked, (key, value) =>
      key === "stacktrace" ? undefined : value
    );
    expect(serialized).not.toContain("jane.doe");

    expect(masked.extra.email).toBe(`${MASKED_EMAIL_LOCAL_PART}@acme.com`);
    expect(masked.request.url).toBe(
      `https://app.shelf.nu/otp?email=${MASKED_EMAIL_LOCAL_PART}%40acme.com&mode=login`
    );
  });

  it("keeps the rest of the error intact", () => {
    const masked = maskEmailsInSentryPayload(ssoErrorEvent());

    expect(masked.extra.domain).toBe("acme.com");
    expect(masked.extra.traceId).toBe("trace-123");
    expect(masked.tags).toEqual({ label: "Auth" });
    expect(masked.user).toEqual({ id: "user-1" });
    expect(masked.exception.values[0].type).toBe("ShelfError");
    expect(masked.breadcrumbs[0].category).toBe("console");
  });

  it("leaves stack frame code locations untouched so symbolication still works", () => {
    const event = ssoErrorEvent();
    const masked = maskEmailsInSentryPayload(event);

    expect(masked.exception.values[0].stacktrace).toEqual(
      event.exception.values[0].stacktrace
    );
  });

  it("masks captured local variables in stack frames", () => {
    const masked = maskEmailsInSentryPayload({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename: "app/utils/sso.server.ts",
                  context_line: "throw new ShelfError({",
                  vars: { email: "jane.doe@acme.com" },
                },
              ],
            },
          },
        ],
      },
    });

    expect(masked.exception.values[0].stacktrace.frames[0]).toEqual({
      filename: "app/utils/sso.server.ts",
      context_line: "throw new ShelfError({",
      vars: { email: `${MASKED_EMAIL_LOCAL_PART}@acme.com` },
    });
  });

  it("does not mutate the event it was given", () => {
    const event = ssoErrorEvent();
    maskEmailsInSentryPayload(event);

    expect(event.extra.email).toBe("jane.doe@acme.com");
  });

  it("masks span descriptions in a transaction", () => {
    const masked = maskEmailsInSentryPayload({
      transaction: "/otp",
      spans: [{ description: "GET /otp.data?email=jane.doe%40acme.com" }],
    });

    expect(masked.spans[0].description).toBe(
      `GET /otp.data?email=${MASKED_EMAIL_LOCAL_PART}%40acme.com`
    );
  });

  it("masks the message and attributes of a structured log", () => {
    const masked = maskEmailsInSentryPayload({
      level: "info",
      message: "No account found for jane.doe@acme.com",
      attributes: { label: "Auth", status: 404 },
    });

    expect(masked).toEqual({
      level: "info",
      message: `No account found for ${MASKED_EMAIL_LOCAL_PART}@acme.com`,
      attributes: { label: "Auth", status: 404 },
    });
  });

  it("copies cyclic structures without recursing forever", () => {
    const node: Record<string, unknown> = { email: "jane.doe@acme.com" };
    node.self = node;

    const masked = maskEmailsInSentryPayload(node);

    expect(masked.email).toBe(`${MASKED_EMAIL_LOCAL_PART}@acme.com`);
    expect(masked.self).toBe(masked);
  });
});
