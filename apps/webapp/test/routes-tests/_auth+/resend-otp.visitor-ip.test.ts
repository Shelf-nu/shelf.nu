// @vitest-environment node

/**
 * Resending a one-time code: the request to Supabase carries the visitor's
 * address, so Supabase's per-IP send limits count each visitor instead of
 * Shelf's servers.
 *
 * @see {@link file://./../../../app/routes/_auth+/resend-otp.tsx}
 * @see {@link file://./../../../app/utils/client-ip.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendOTP } from "~/modules/auth/service.server";
import { action } from "~/routes/_auth+/resend-otp";

// why: sending a code is a Supabase call; the test asserts on what it is
// handed.
vi.mock("~/modules/auth/service.server", () => ({
  sendOTP: vi.fn(),
}));

const EMAIL = "someone@example.com";
const VISITOR_IP = "203.0.113.7";

/** POSTs the resend form for `email`, forwarded by one proxy. */
function resendArgs(email: string) {
  return {
    request: new Request("http://localhost:3000/resend-otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // The visitor's address as a self-hosted proxy reports it.
        "X-Forwarded-For": VISITOR_IP,
      },
      body: new URLSearchParams({ email }),
    }),
    context: {},
    params: {},
  } as unknown as ActionFunctionArgs;
}

describe("resend-otp action: visitor address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendOTP).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the visitor's address to Supabase with the code", async () => {
    // why: a self-hosted instance with one proxy in front, so the proxy's
    // X-Forwarded-For entry names the visitor.
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    await action(resendArgs(EMAIL));

    expect(sendOTP).toHaveBeenCalledWith(EMAIL, { clientIp: VISITOR_IP });
  });

  it("passes no address when no proxy is trusted", async () => {
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");

    await action(resendArgs(EMAIL));

    // A client-chosen X-Forwarded-For is never forwarded to Supabase.
    expect(sendOTP).toHaveBeenCalledWith(EMAIL, { clientIp: null });
  });
});
