/**
 * Which key the admin client authenticates with, and when it tells Supabase
 * Auth the visitor's IP. Supabase only reads `Sb-Forwarded-For` on requests
 * made with a secret key, so the header goes with the secret key or not at all.
 *
 * Supabase Auth is answered by MSW at its HTTP boundary, so the real client
 * library builds the requests.
 *
 * @see {@link file://./client.ts}
 */
// @vitest-environment node
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@mocks";
import { SUPABASE_URL } from "@mocks/handlers";
import { getSupabaseAdmin } from "./client";

const keys = vi.hoisted(() => ({
  SUPABASE_SECRET_KEY: undefined as string | undefined,
  SUPABASE_SERVICE_ROLE: "legacy-service-role",
}));

// why: the configured keys are read from the environment at import; each case
// picks which ones an operator has set.
vi.mock("~/utils/env", async () => ({
  SUPABASE_URL: (await import("@mocks/handlers")).SUPABASE_URL,
  SUPABASE_ANON_PUBLIC: "anon",
  get SUPABASE_SECRET_KEY() {
    return keys.SUPABASE_SECRET_KEY;
  },
  get SUPABASE_SERVICE_ROLE() {
    return keys.SUPABASE_SERVICE_ROLE;
  },
}));

/**
 * Answers a password sign-in and records the headers Shelf sent.
 *
 * @returns The recorded headers
 */
function recordSignInHeaders() {
  const seen: Headers[] = [];
  server.use(
    http.post(`${SUPABASE_URL}/auth/v1/token`, ({ request }) => {
      seen.push(request.headers);
      return HttpResponse.json(
        { error: "invalid_grant", error_description: "Invalid login" },
        { status: 400 }
      );
    })
  );
  return seen;
}

/** Signs in through the admin client as a visitor from `clientIp`. */
async function signIn(clientIp?: string | null) {
  await getSupabaseAdmin({ clientIp }).auth.signInWithPassword({
    email: "jane@example.com",
    password: "wrong",
  });
}

afterEach(() => {
  keys.SUPABASE_SECRET_KEY = undefined;
});

describe("getSupabaseAdmin", () => {
  it("uses the secret key and forwards the visitor IP when a secret key is set", async () => {
    keys.SUPABASE_SECRET_KEY = "sb_secret_test";
    const seen = recordSignInHeaders();

    await signIn("203.0.113.7");

    expect(seen[0].get("apikey")).toBe("sb_secret_test");
    expect(seen[0].get("sb-forwarded-for")).toBe("203.0.113.7");
  });

  it("sends no forwarded IP when the visitor's IP is unknown", async () => {
    keys.SUPABASE_SECRET_KEY = "sb_secret_test";
    const seen = recordSignInHeaders();

    await signIn(null);

    expect(seen[0].get("sb-forwarded-for")).toBeNull();
  });

  it("falls back to the legacy service_role key without forwarding the IP", async () => {
    const seen = recordSignInHeaders();

    await signIn("203.0.113.7");

    expect(seen[0].get("apikey")).toBe("legacy-service-role");
    expect(seen[0].get("sb-forwarded-for")).toBeNull();
  });
});
