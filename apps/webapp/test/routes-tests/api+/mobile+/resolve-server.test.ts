/**
 * Route tests for POST /api/mobile/resolve-server.
 *
 * Asserts the HTTP contract the companion app depends on: POST-only, one answer
 * for one domain, never an enumerable listing, and fail-open on bad input so a
 * malformed request can't block sign-in.
 *
 * @see apps/webapp/app/routes/api+/mobile+/resolve-server.ts
 */
import { createActionArgs } from "@mocks/remix";
import { describe, expect, it, vi } from "vitest";

// why: React Router v7's single-fetch `data()` returns a DataWithResponseInit,
// not a Response, so it has no .json(). Mapping it to a real Response is the
// established pattern in this suite (see api.kits.bulk-actions.test.ts) and
// lets these tests assert status and body the way the app actually sees them.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
          },
        })
    )
);

// why: swaps in the Response-returning `data()` built above, so the assertions
// can read a status and a body instead of unwrapping a DataWithResponseInit.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: mock ONLY the resolver's environment input, not the resolver itself.
// `resolveCompanionServer` is internal business logic (a pure function over an
// env string), and stubbing it would let a change to its return contract slip
// through with both this suite and the resolver's own suite green while the
// deployed endpoint ships a wrong body. `importActual` is spread in because the
// route pulls `~/utils/http.server`, which reads SERVER_URL / URL_SHORTENER
// from this module at import time.
const mockEnv = {
  COMPANION_SERVERS: JSON.stringify({
    "acme.edu": "https://acme.i.shelf.nu",
    // Object form: same target, plus the app-only presentation flag.
    "globex.com": {
      url: "https://globex.i.shelf.nu",
      disablePasswordLogin: true,
    },
  }),
};
vi.mock("~/utils/env", async () => ({
  ...(await vi.importActual<typeof import("~/utils/env")>("~/utils/env")),
  get COMPANION_SERVERS() {
    return mockEnv.COMPANION_SERVERS;
  },
}));

const { action } = await import("~/routes/api+/mobile+/resolve-server");

/** Builds a request for the route, defaulting to a well-formed POST. */
function request(body: unknown, method = "POST") {
  return new Request("http://localhost/api/mobile/resolve-server", {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Invokes the action with the arg shape React Router passes.
 *
 * The `as unknown as Response` cast is the established pattern in this suite:
 * `data()`'s static type is `DataWithResponseInit`, but the mock above returns
 * a real `Response`, which is what the assertions need.
 */
async function invoke(req: Request): Promise<Response> {
  return (await action(
    createActionArgs({ request: req })
  )) as unknown as Response;
}

describe("POST /api/mobile/resolve-server", () => {
  it("returns the base URL for a registered domain", async () => {
    const response = await invoke(request({ domain: "acme.edu" }));
    await expect(response.json()).resolves.toEqual({
      baseUrl: "https://acme.i.shelf.nu",
      disablePasswordLogin: false,
    });
  });

  it("reports the app-only password flag for a server that sets it", async () => {
    const response = await invoke(request({ domain: "globex.com" }));
    await expect(response.json()).resolves.toEqual({
      baseUrl: "https://globex.i.shelf.nu",
      disablePasswordLogin: true,
    });
  });

  it("defaults the flag off for a plain string entry", async () => {
    // The bare-URL form must keep working untouched — it is what every
    // existing registry uses.
    const response = await invoke(request({ domain: "acme.edu" }));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.disablePasswordLogin).toBe(false);
  });

  it("returns null for an unregistered domain", async () => {
    const response = await invoke(request({ domain: "unknown.org" }));
    await expect(response.json()).resolves.toEqual({
      baseUrl: null,
      disablePasswordLogin: false,
    });
  });

  it("returns null for a missing domain rather than erroring", async () => {
    const response = await invoke(request({}));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      baseUrl: null,
      disablePasswordLogin: false,
    });
  });

  it("returns null for a non-JSON body rather than erroring", async () => {
    const response = await invoke(
      new Request("http://localhost/api/mobile/resolve-server", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      baseUrl: null,
      disablePasswordLogin: false,
    });
  });

  it("rejects non-POST methods", async () => {
    const response = await invoke(request(null, "GET"));
    expect(response.status).toBe(405);
  });

  it("never returns anything beyond the single answer", async () => {
    const response = await invoke(request({ domain: "acme.edu" }));
    const body = (await response.json()) as Record<string, unknown>;
    // This endpoint is unauthenticated, so every key here is public. Widening
    // it is a deliberate act — update this list only alongside that decision.
    expect(Object.keys(body).sort()).toEqual([
      "baseUrl",
      "disablePasswordLogin",
    ]);
  });
});
