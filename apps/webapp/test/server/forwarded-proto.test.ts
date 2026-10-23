/**
 * Form submissions behind a TLS-terminating proxy.
 *
 * Fly (and most self-hosted setups) terminate HTTPS at the proxy and forward
 * plain HTTP to the Node server, so the request URL the app sees is `http://`
 * while the browser's `Origin` header is `https://`. React Router's action CSRF
 * check compares the full origin (scheme included), so these tests run real
 * `.data` action requests through React Router's request handler to pin that
 * a proxied HTTPS form submission is accepted and a cross-site one is not.
 *
 * @see {@link file://./../../server/middleware.ts} applyForwardedProto
 */
import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import type { ServerBuild } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { applyForwardedProto } from "@server/middleware";

// @vitest-environment node

/** The action under test; records that React Router let the request through. */
const action = vi.fn(() => ({ ok: true }));

/**
 * A one-route React Router build. Only the fields the request handler reads
 * for a `.data` action request are filled in; the cast is limited to this
 * hand-written fixture.
 */
const build = {
  entry: { module: { default: () => new Response("") } },
  routes: {
    root: {
      id: "root",
      path: "",
      module: { default: () => null },
    },
    "routes/logout": {
      id: "routes/logout",
      parentId: "root",
      path: "logout",
      module: { action, default: () => null },
    },
  },
  assets: {
    routes: {},
    entry: { module: "", imports: [] },
    url: "",
    version: "test",
  },
  publicPath: "/",
  assetsBuildDirectory: "",
  future: {},
  ssr: true,
  isSpaMode: false,
  prerender: [],
  routeDiscovery: { mode: "lazy", manifestPath: "/__manifest" },
} as unknown as ServerBuild;

/**
 * A Hono app shaped like the production server: optional proxy middleware,
 * then React Router handling every request.
 */
function buildApp({ withMiddleware }: { withMiddleware: boolean }) {
  const app = new Hono();
  if (withMiddleware) app.use("*", applyForwardedProto());
  const handler = createRequestHandler(build, "production");
  app.all("*", (c) => handler(c.req.raw));
  return app;
}

/**
 * A logout form submission as Fly forwards it: plain HTTP to the app, with
 * the browser's HTTPS origin and the proxy's `X-Forwarded-Proto`.
 */
function proxiedLogout(
  app: Hono,
  { origin, forwardedProto }: { origin: string; forwardedProto?: string }
) {
  const headers: Record<string, string> = {
    host: "app.shelf.test",
    origin,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (forwardedProto) headers["x-forwarded-proto"] = forwardedProto;
  return app.request("http://app.shelf.test/logout.data", {
    method: "POST",
    headers,
    body: "",
  });
}

describe("form submissions behind a TLS-terminating proxy", () => {
  it("rejects a proxied HTTPS submission when the request URL stays http", async () => {
    action.mockClear();
    const res = await proxiedLogout(buildApp({ withMiddleware: false }), {
      origin: "https://app.shelf.test",
      forwardedProto: "https",
    });

    expect(res.status).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });

  it("accepts a proxied HTTPS submission once X-Forwarded-Proto is applied", async () => {
    action.mockClear();
    const res = await proxiedLogout(buildApp({ withMiddleware: true }), {
      origin: "https://app.shelf.test",
      forwardedProto: "https",
    });

    expect(res.status).toBe(200);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("still rejects a submission from another site", async () => {
    action.mockClear();
    const res = await proxiedLogout(buildApp({ withMiddleware: true }), {
      origin: "https://evil.example",
      forwardedProto: "https",
    });

    expect(res.status).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });

  it("leaves a direct HTTP request unchanged when no proxy header is sent", async () => {
    action.mockClear();
    const res = await proxiedLogout(buildApp({ withMiddleware: true }), {
      origin: "http://app.shelf.test",
    });

    expect(res.status).toBe(200);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
