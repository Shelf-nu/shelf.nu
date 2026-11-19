// @vitest-environment node

/**
 * Mobile SSO token exchange: redeeming the single-use code refreshes the SSO
 * session through Supabase, so the request carries the visitor's address and
 * Supabase's per-IP limits count each phone instead of Shelf's servers.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/exchange.ts}
 * @see {@link file://./../../../../app/modules/auth/mobile-sso.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteExpiredMobileAuthCodes,
  redeemMobileAuthCode,
} from "~/modules/auth/mobile-sso.server";
import { action } from "~/routes/api+/mobile+/exchange";

// why: redeeming a code reads and deletes a database row and refreshes the
// session with Supabase; the test asserts on what the redeem is handed.
vi.mock("~/modules/auth/mobile-sso.server", () => ({
  redeemMobileAuthCode: vi.fn(),
  deleteExpiredMobileAuthCodes: vi.fn(),
}));

const VISITOR_IP = "203.0.113.7";
const CODE = "single-use-code";
/** A PKCE verifier in the RFC 7636 charset and length. */
const CODE_VERIFIER = "v".repeat(43);

/** POSTs an exchange body, forwarded by one proxy. */
function exchangeArgs(body: unknown) {
  return {
    request: new Request("http://localhost:3000/api/mobile/exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The visitor's address as a self-hosted proxy reports it.
        "X-Forwarded-For": VISITOR_IP,
      },
      body: JSON.stringify(body),
    }),
    context: {},
    params: {},
  } as unknown as ActionFunctionArgs;
}

describe("mobile exchange action: visitor address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redeemMobileAuthCode).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    } as never);
    vi.mocked(deleteExpiredMobileAuthCodes).mockResolvedValue(
      undefined as never
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the visitor's address to the redeem and returns the tokens", async () => {
    // why: a self-hosted instance with one proxy in front, so the proxy's
    // X-Forwarded-For entry names the visitor.
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    const result = (await action(
      exchangeArgs({ code: CODE, codeVerifier: CODE_VERIFIER })
    )) as unknown as { data: unknown };

    expect(redeemMobileAuthCode).toHaveBeenCalledWith(CODE, CODE_VERIFIER, {
      clientIp: VISITOR_IP,
    });
    // The companion app reads these two fields into supabase.auth.setSession.
    expect(result.data).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });
});
