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

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: isolates the route from env/registry wiring so these tests assert the
// HTTP contract, not the registry's own parsing — that is covered by
// app/modules/api/companion-servers.server.test.ts.
vi.mock("~/modules/api/companion-servers.server", () => ({
  resolveCompanionServer: (domain: string) =>
    domain === "acme.edu" ? "https://acme.i.shelf.nu" : null,
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
    });
  });

  it("returns null for an unregistered domain", async () => {
    const response = await invoke(request({ domain: "unknown.org" }));
    await expect(response.json()).resolves.toEqual({ baseUrl: null });
  });

  it("returns null for a missing domain rather than erroring", async () => {
    const response = await invoke(request({}));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ baseUrl: null });
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
    await expect(response.json()).resolves.toEqual({ baseUrl: null });
  });

  it("rejects non-POST methods", async () => {
    const response = await invoke(request(null, "GET"));
    expect(response.status).toBe(405);
  });

  it("never returns anything beyond the single answer", async () => {
    const response = await invoke(request({ domain: "acme.edu" }));
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["baseUrl"]);
  });
});
