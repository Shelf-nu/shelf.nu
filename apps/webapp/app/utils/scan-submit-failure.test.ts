/**
 * Behaviour tests for the scanner save's transport-failure handling.
 *
 * The case being pinned is the one no other check can see: a save request that
 * gets no usable answer. The page must be kept, the result must not claim the
 * save failed, and everything that is not a transport failure must still reach
 * the error boundary or the router exactly as it did.
 *
 * @see {@link file://./scan-submit-failure.ts}
 */
import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from "react-router";
import { describe, expect, it } from "vitest";

import {
  classifyScanSubmitFailure,
  getScanSubmitFailure,
  keepScanListOnSubmitFailure,
} from "./scan-submit-failure";

/** What React Router throws for a non-app response with this status. */
function gatewayResponse(status: number) {
  return new ErrorResponseImpl(status, "", "<html>gateway page</html>");
}

/** Runs the client action against a server action that rejects with `thrown`. */
function submitRejectingWith(thrown: unknown) {
  return keepScanListOnSubmitFailure({
    serverAction: () => Promise.reject(thrown),
  });
}

describe("classifyScanSubmitFailure", () => {
  it.each([408, 504, 522, 524])("reads a %i as a timeout", (status) => {
    expect(classifyScanSubmitFailure(gatewayResponse(status))).toEqual({
      kind: "timeout",
      status,
    });
  });

  it.each([500, 502, 503])("reads a %i as a server failure", (status) => {
    expect(classifyScanSubmitFailure(gatewayResponse(status))).toEqual({
      kind: "server",
      status,
    });
  });

  it("reads a rejected fetch as a network failure", () => {
    expect(classifyScanSubmitFailure(new TypeError("Failed to fetch"))).toEqual(
      { kind: "network", status: null }
    );
  });

  it("reads an undecodable response body as a server failure", () => {
    expect(
      classifyScanSubmitFailure(
        new Error("Unable to decode turbo-stream response")
      )
    ).toEqual({ kind: "server", status: null });
  });

  it.each([401, 403, 404])("leaves a %i for the error boundary", (status) => {
    expect(classifyScanSubmitFailure(gatewayResponse(status))).toBeNull();
  });

  it.each(["NetworkError when attempting to fetch resource.", "Load failed"])(
    "reads the browser message %j as a network failure",
    (message) => {
      expect(classifyScanSubmitFailure(new TypeError(message))).toEqual({
        kind: "network",
        status: null,
      });
    }
  );

  /** A bug must stay loud: it is not a bad connection. */
  it("leaves a TypeError from a programming mistake for the error boundary", () => {
    const bug = new TypeError("Cannot read properties of undefined");

    expect(classifyScanSubmitFailure(bug)).toBeNull();
  });

  /**
   * The app's own 5xx carries its error payload and message. That is an
   * answer, so it is not reported as a save that could not be confirmed.
   */
  it("leaves a 5xx the app answered itself for the error boundary", () => {
    const appError = new ErrorResponseImpl(500, "", {
      error: { message: "Something went wrong while saving." },
    });

    expect(classifyScanSubmitFailure(appError)).toBeNull();
  });

  it("leaves an interrupted navigation alone", () => {
    const aborted = new DOMException("The operation was aborted", "AbortError");

    expect(classifyScanSubmitFailure(aborted)).toBeNull();
  });

  it("leaves a thrown redirect for the router", () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "/bookings/booking-1" },
    });

    expect(classifyScanSubmitFailure(redirect)).toBeNull();
  });

  it("leaves an unrelated error alone", () => {
    expect(classifyScanSubmitFailure(new Error("boom"))).toBeNull();
  });
});

describe("keepScanListOnSubmitFailure", () => {
  it("returns a gateway timeout as action data instead of throwing", async () => {
    const result = await submitRejectingWith(gatewayResponse(524));

    expect(result).toMatchObject({
      data: { scanSubmitFailure: { kind: "timeout", status: 524 } },
    });
  });

  /**
   * React Router revalidates after an action unless it answered 4xx or 5xx. A
   * revalidation sent to a server that just failed to answer would fail too
   * and replace the page after all, so the status has to travel with the data.
   */
  it("carries the failing status so the router does not revalidate", async () => {
    const result = await submitRejectingWith(gatewayResponse(524));

    expect(result).toMatchObject({ init: { status: 524 } });
  });

  it("reports an error status when no response arrived at all", async () => {
    const result = await submitRejectingWith(new TypeError("Failed to fetch"));

    expect(result).toMatchObject({
      data: { scanSubmitFailure: { kind: "network", status: null } },
      init: { status: 503 },
    });
  });

  it("hands back the server action's own result untouched", async () => {
    const refusal = { error: { message: "Booking not found." } };

    const result = await keepScanListOnSubmitFailure({
      serverAction: () => Promise.resolve(refusal),
    });

    expect(result).toBe(refusal);
  });

  it("rethrows what is not a transport failure", async () => {
    const forbidden = gatewayResponse(403);

    await expect(submitRejectingWith(forbidden)).rejects.toBe(forbidden);
  });
});

describe("getScanSubmitFailure", () => {
  it("reads the failure out of action data", () => {
    expect(
      getScanSubmitFailure({
        scanSubmitFailure: { kind: "timeout", status: 524 },
      })
    ).toEqual({ kind: "timeout", status: 524 });
  });

  it.each([
    ["nothing submitted yet", undefined],
    ["a refusal the server answered", { error: { message: "Not allowed" } }],
    ["a success payload", { error: null }],
  ])("returns null for %s", (_label, actionData) => {
    expect(getScanSubmitFailure(actionData)).toBeNull();
  });
});
