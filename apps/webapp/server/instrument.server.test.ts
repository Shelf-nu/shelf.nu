/**
 * The ShelfError overlay merged into every captured Sentry error event, and
 * the credentials scrubbed from the request Sentry attaches to it.
 *
 * `extra` is built from the error's `additionalData`, message and cause, all of
 * which can carry user-submitted values. It must not leak a credential and must
 * stay bounded, matching what the log line gets from `redactSensitive`.
 *
 * @see {@link file://./instrument.server.ts} `makeSentryContext`
 * @see {@link file://./../app/utils/redact.ts}
 */
import type { Event } from "@sentry/react-router";
import { describe, expect, it } from "vitest";

import { ShelfError } from "~/utils/error";
import { MAX_LOGGED_STRING_LENGTH } from "~/utils/redact";
import {
  handleBeforeSendTransaction,
  makeSentryContext,
  scrubEventRequest,
} from "./instrument.server";

/** `extra` spreads arbitrary `additionalData` keys, so tests read it as a record. */
function extraOf(error: ShelfError): Record<string, unknown> | undefined {
  return makeSentryContext(error)?.extra;
}

// @vitest-environment node

describe("makeSentryContext", () => {
  it("caps long strings in additionalData", () => {
    const huge = "x".repeat(800_000);
    const error = new ShelfError({
      cause: null,
      message: "Upload failed",
      label: "File storage",
      additionalData: { imageUrl: huge },
    });

    const extra = extraOf(error);

    expect(String(extra?.imageUrl).length).toBeLessThan(
      MAX_LOGGED_STRING_LENGTH + 100
    );
  });

  it("strips credentials from a URL in additionalData", () => {
    const error = new ShelfError({
      cause: null,
      message: "Upload failed",
      label: "File storage",
      additionalData: { imageUrl: "https://user:hunter2@example.com/a.png" },
    });

    expect(JSON.stringify(extraOf(error))).not.toContain("hunter2");
  });

  it("bounds the message and the serialized cause", () => {
    const huge = "y".repeat(800_000);
    const error = new ShelfError({
      cause: new ShelfError({
        cause: null,
        message: huge,
        label: "Assets",
        additionalData: { data: huge },
      }),
      message: huge,
      label: "Assets",
    });

    const extra = extraOf(error);

    expect(JSON.stringify(extra).length).toBeLessThan(
      MAX_LOGGED_STRING_LENGTH * 4
    );
  });

  it("still redacts secret-keyed values", () => {
    const error = new ShelfError({
      cause: null,
      message: "Refresh failed",
      label: "Auth",
      additionalData: { refreshToken: "s3cr3t", userId: "user-1" },
    });

    const extra = extraOf(error);

    expect(JSON.stringify(extra)).not.toContain("s3cr3t");
    expect(extra?.userId).toBe("user-1");
  });
});

describe("scrubEventRequest", () => {
  it("drops credentials and the proxy secret from request headers, whatever their case", () => {
    const event: Event = {
      request: {
        headers: {
          Cookie: "__authSession=abc",
          authorization: "Bearer token",
          "X-Shelf-Proxy-Secret": "zone-secret",
          "user-agent": "Mozilla/5.0",
        },
        cookies: { __authSession: "abc", sso_code_verifier: "verifier" },
      },
    };

    scrubEventRequest(event);

    expect(event.request?.headers).toEqual({ "user-agent": "Mozilla/5.0" });
    // Parsed cookies go entirely: they hold the session and the SSO verifier.
    expect(event.request?.cookies).toBeUndefined();
  });

  it("leaves an event without a request alone", () => {
    const event: Event = { message: "no request" };
    scrubEventRequest(event);
    expect(event).toEqual({ message: "no request" });
  });
});

describe("handleBeforeSendTransaction", () => {
  it("scrubs the request on a transaction before it is sent", () => {
    const transaction: Event = {
      type: "transaction",
      request: {
        headers: { "x-shelf-proxy-secret": "zone-secret", accept: "*/*" },
        cookies: { __authSession: "abc" },
      },
    };

    const sent = handleBeforeSendTransaction(transaction);

    expect(sent.request?.headers).toEqual({ accept: "*/*" });
    expect(sent.request?.cookies).toBeUndefined();
  });

  describe("Prisma span volume", () => {
    /** A span as the SDK puts it on a transaction event. */
    function span(
      id: string,
      parent: string,
      op: string,
      description: string
    ): NonNullable<Event["spans"]>[number] {
      return {
        span_id: id,
        parent_span_id: parent,
        op,
        description,
        trace_id: "t",
        start_timestamp: 0,
        data: {},
      };
    }

    /** One Prisma `findMany`, shaped the way @prisma/instrumentation reports it. */
    function prismaQuery(): Event {
      return {
        type: "transaction",
        spans: [
          span("op", "root", "default", "prisma:client:operation"),
          span("ser", "op", "default", "prisma:client:serialize"),
          span("conn", "op", "db", "prisma:engine:connection"),
          span("eq", "op", "default", "prisma:engine:query"),
          span("eser", "eq", "default", "prisma:engine:serialize"),
          span("begin", "eq", "db", "BEGIN"),
          span("dealloc", "eq", "db", "DEALLOCATE ALL"),
          span("sql", "eq", "db", 'SELECT "public"."Asset"."id" FROM "Asset"'),
          span("commit", "eq", "db", "COMMIT"),
          span(
            "json",
            "eq",
            "default",
            "prisma:engine:response_json_serialization"
          ),
          span("http", "root", "http.client", "GET https://example.com"),
        ],
      };
    }

    it("keeps the SQL query and drops Prisma's bookkeeping spans", () => {
      const sent = handleBeforeSendTransaction(prismaQuery());

      expect(sent.spans?.map((s) => s.description)).toEqual([
        'SELECT "public"."Asset"."id" FROM "Asset"',
        "GET https://example.com",
      ]);
    });

    it("hangs a kept query off the nearest kept ancestor", () => {
      // Both Prisma parents of the SQL span are dropped, so it moves up to the
      // transaction root instead of pointing at a span that was never sent.
      const sent = handleBeforeSendTransaction(prismaQuery());
      const sql = sent.spans?.find((s) => s.span_id === "sql");

      expect(sql?.parent_span_id).toBe("root");
    });

    it("keeps a real query whose text merely contains BEGIN or COMMIT", () => {
      const transaction: Event = {
        type: "transaction",
        spans: [
          span("a", "root", "db", "SELECT 'BEGIN' AS note"),
          span("b", "root", "db", "UPDATE log SET msg = 'COMMIT'"),
        ],
      };

      expect(handleBeforeSendTransaction(transaction).spans).toHaveLength(2);
    });

    it("keeps spans that are not database spans, whatever their name", () => {
      const transaction: Event = {
        type: "transaction",
        spans: [span("a", "root", "function", "BEGIN")],
      };

      expect(handleBeforeSendTransaction(transaction).spans).toHaveLength(1);
    });
  });
});
