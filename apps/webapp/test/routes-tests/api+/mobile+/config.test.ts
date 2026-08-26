/**
 * Route tests for GET /api/mobile/config — the per-instance self-description
 * the companion app reads before switching servers.
 *
 * The "no keys beyond the contract" test is the important one: this endpoint is
 * unauthenticated, so any field added here becomes public on every Shelf
 * instance. It must fail loudly if someone widens the payload.
 *
 * @see apps/webapp/app/routes/api+/mobile+/config.ts
 */
import { createLoaderArgs } from "@mocks/remix";
import { afterEach, describe, expect, it, vi } from "vitest";

// why: React Router v7's single-fetch `data()` returns a DataWithResponseInit,
// not a Response. Mapping it to a real Response matches the rest of this suite.
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

// why: the route reads module-scope env exports; mocking the env module keeps
// the assertions independent of the developer's local .env.
vi.mock("~/utils/env", () => ({
  SUPABASE_URL: "https://xyz.supabase.co",
  SUPABASE_ANON_PUBLIC: "anon-key-123",
  INSTANCE_NAME: "Acme University",
  MIN_COMPANION_VERSION: "1.4.0",
}));

// why: `ssoEnabled` and `passwordLoginEnabled` are derived from config flags
// that read DISABLE_SSO / DISABLE_PASSWORD_LOGIN. Pinning them keeps the
// asserted payload deterministic regardless of the local or CI environment.
// Mutable so a test can flip a flag and re-read the loader.
const mockConfig = vi.hoisted(() => ({
  disableSSO: false,
  disablePasswordLogin: false,
}));

vi.mock("~/config/shelf.config", () => ({ config: mockConfig }));

const { loader } = await import("~/routes/api+/mobile+/config");

/**
 * Invokes the loader with the arg shape React Router passes.
 *
 * The `as unknown as Response` cast is the established pattern in this suite:
 * `data()`'s static type is `DataWithResponseInit`, but the mock above returns
 * a real `Response`, which is what the assertions need.
 */
function invoke(): Response {
  return loader(
    createLoaderArgs({
      request: new Request("http://localhost/api/mobile/config"),
    })
  ) as unknown as Response;
}

describe("GET /api/mobile/config", () => {
  it("describes the instance", async () => {
    const response = await invoke();
    await expect(response.json()).resolves.toEqual({
      name: "Acme University",
      supabaseUrl: "https://xyz.supabase.co",
      supabaseAnonKey: "anon-key-123",
      mobileApiVersion: 1,
      minCompanionVersion: "1.4.0",
      ssoEnabled: true,
      passwordLoginEnabled: true,
    });
  });

  it("exposes no keys beyond the documented contract", async () => {
    const response = await invoke();
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "minCompanionVersion",
      "mobileApiVersion",
      "name",
      "passwordLoginEnabled",
      "ssoEnabled",
      "supabaseAnonKey",
      "supabaseUrl",
    ]);
  });
});

describe("GET /api/mobile/config — advertised sign-in methods", () => {
  afterEach(() => {
    mockConfig.disableSSO = false;
    mockConfig.disablePasswordLogin = false;
  });

  it("advertises both methods by default", async () => {
    const body = (await (await invoke()).json()) as Record<string, unknown>;
    expect(body.ssoEnabled).toBe(true);
    expect(body.passwordLoginEnabled).toBe(true);
  });

  it("withdraws password login when the instance disables it", async () => {
    // The app hides its password fields on this. It is an affordance, not a
    // gate — the app authenticates against Supabase directly, so this instance
    // never sees the attempt and cannot refuse it.
    mockConfig.disablePasswordLogin = true;

    const body = (await (await invoke()).json()) as Record<string, unknown>;
    expect(body.passwordLoginEnabled).toBe(false);
    expect(body.ssoEnabled).toBe(true);
  });

  it("withdraws SSO when the instance disables it", async () => {
    mockConfig.disableSSO = true;

    const body = (await (await invoke()).json()) as Record<string, unknown>;
    expect(body.ssoEnabled).toBe(false);
    expect(body.passwordLoginEnabled).toBe(true);
  });
});
