import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  createMobileAuthCode,
  deleteExpiredMobileAuthCodes,
  redeemMobileAuthCode,
} from "./mobile-sso.server";

// why: exercise the service logic without a real database
const dbMocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: { mobileAuthCode: dbMocks },
}));

// why: stub the Supabase admin client so generateLink/verifyOtp never hit the
// network; assert we call them with the expected magiclink arguments instead.
const supabaseMocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: {
      admin: { generateLink: supabaseMocks.generateLink },
      verifyOtp: supabaseMocks.verifyOtp,
    },
  })),
}));

// why: control Supabase error classification (transient/retryable vs
// deterministic) by tagging mock errors, rather than constructing real
// AuthError instances. mobile-sso.server only imports these two helpers.
vi.mock("@supabase/supabase-js", () => ({
  isAuthApiError: (err: unknown) =>
    typeof err === "object" && err !== null && "__authApiError" in err,
  isAuthRetryableFetchError: (err: unknown) =>
    typeof err === "object" && err !== null && "__retryable" in err,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A valid PKCE pair: `TEST_CHALLENGE` is the S256 hash of `TEST_VERIFIER`.
 *
 * Redemption requires a bound challenge, so every test that expects to reach
 * the mint must present one. A challenge-less redemption is pinned as refused
 * below — that is the property this suite exists to protect.
 */
const TEST_VERIFIER = "t".repeat(64);
const TEST_CHALLENGE = createHash("sha256")
  .update(TEST_VERIFIER)
  .digest("base64url");

/** Wires the happy-path mocks for a successful redeem + fresh-session mint. */
function mockSuccessfulMint(
  email = "sso@acme.com",
  codeChallenge: string | null = TEST_CHALLENGE
) {
  dbMocks.updateMany.mockResolvedValue({ count: 1 });
  dbMocks.findUniqueOrThrow.mockResolvedValue({
    user: { email },
    codeChallenge,
  });
  supabaseMocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hash_123" } },
    error: null,
  });
  supabaseMocks.verifyOtp.mockResolvedValue({
    data: {
      session: {
        access_token: "at",
        refresh_token: "rt",
        user: { id: "user_1", email },
        expires_in: 3600,
        expires_at: 9_999_999_999,
      },
    },
    error: null,
  });
}

describe("createMobileAuthCode", () => {
  it("persists only the hash + a future expiry and returns the plaintext", async () => {
    dbMocks.create.mockResolvedValue({});

    const code = await createMobileAuthCode("user_1");

    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(20); // ~256-bit base64url
    expect(dbMocks.create).toHaveBeenCalledTimes(1);

    const { data } = dbMocks.create.mock.calls[0][0];
    expect(data.userId).toBe("user_1");
    expect(data).not.toHaveProperty("code"); // plaintext is never stored
    expect(data.codeHash).toEqual(expect.any(String));
    expect(data.codeHash).not.toEqual(code); // stored value is the hash
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(data.codeChallenge).toBeNull(); // no PKCE challenge when omitted
  });

  it("stores the PKCE challenge when provided", async () => {
    dbMocks.create.mockResolvedValue({});

    await createMobileAuthCode("user_1", "challenge_abc");

    const { data } = dbMocks.create.mock.calls[0][0];
    expect(data.codeChallenge).toBe("challenge_abc");
  });
});

describe("redeemMobileAuthCode", () => {
  it("rejects an empty code with a 400 and never touches the database", async () => {
    await expect(redeemMobileAuthCode("")).rejects.toMatchObject({
      status: 400,
    });
    expect(dbMocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid/expired/used code with a uniform 400 and does not mint", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(redeemMobileAuthCode("nope")).rejects.toMatchObject({
      status: 400,
    });
    expect(supabaseMocks.generateLink).not.toHaveBeenCalled();
  });

  it("consumes the code atomically (single-use guard) before minting", async () => {
    mockSuccessfulMint();

    await redeemMobileAuthCode("good-code", TEST_VERIFIER);

    const { where, data } = dbMocks.updateMany.mock.calls[0][0];
    expect(where.consumedAt).toBeNull(); // only unconsumed rows
    expect(where.expiresAt).toHaveProperty("gt"); // only unexpired rows
    expect(data.consumedAt).toBeInstanceOf(Date); // marks it consumed
  });

  it("mints a fresh, independent session via generateLink → verifyOtp", async () => {
    mockSuccessfulMint("sso@acme.com");

    const session = await redeemMobileAuthCode("good-code", TEST_VERIFIER);

    expect(supabaseMocks.generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "sso@acme.com",
    });
    expect(supabaseMocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash_123",
      type: "magiclink",
    });
    expect(session).toMatchObject({
      accessToken: "at",
      refreshToken: "rt",
      userId: "user_1",
      email: "sso@acme.com",
    });
  });

  it("fails if Supabase returns no verifiable token (and never verifies)", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      user: { email: "sso@acme.com" },
      codeChallenge: TEST_CHALLENGE,
    });
    supabaseMocks.generateLink.mockResolvedValue({
      data: { properties: {} }, // no hashed_token
      error: null,
    });

    await expect(
      redeemMobileAuthCode("good-code", TEST_VERIFIER)
    ).rejects.toBeInstanceOf(ShelfError);
    expect(supabaseMocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("retries a superseded magic-link token, then succeeds", async () => {
    // Two overlapping sign-ins for one account: the second generateLink voids
    // the first's token, and the first verifyOtp loses. A retry mints a NEW
    // token, so the very thing that failed is what the retry replaces.
    mockSuccessfulMint("sso@acme.com", TEST_CHALLENGE);
    supabaseMocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash_123" } },
      error: null,
    });
    supabaseMocks.verifyOtp
      .mockResolvedValueOnce({
        data: null,
        error: {
          __authApiError: true,
          code: "otp_expired",
          status: 403,
          message: "Email link is invalid or has expired",
        },
      })
      .mockResolvedValueOnce({
        data: {
          session: {
            access_token: "at",
            refresh_token: "rt",
            user: { id: "user_1", email: "sso@acme.com" },
            expires_in: 3600,
            expires_at: 9_999_999_999,
          },
        },
        error: null,
      });

    const session = await redeemMobileAuthCode("good-code", TEST_VERIFIER);

    expect(session).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    // A fresh link per attempt is the whole reason the retry can work.
    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(2);
  });

  it("recognises a superseded token from its message alone", async () => {
    // Supabase releases predating the error-code vocabulary send no `code`.
    mockSuccessfulMint("sso@acme.com", TEST_CHALLENGE);
    supabaseMocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash_123" } },
      error: null,
    });
    supabaseMocks.verifyOtp
      .mockResolvedValueOnce({
        data: null,
        error: {
          __authApiError: true,
          status: 403,
          message: "Email link is invalid or has expired",
        },
      })
      .mockResolvedValueOnce({
        data: {
          session: {
            access_token: "at",
            refresh_token: "rt",
            user: { id: "user_1", email: "sso@acme.com" },
            expires_in: 3600,
            expires_at: 9_999_999_999,
          },
        },
        error: null,
      });

    const session = await redeemMobileAuthCode("good-code", TEST_VERIFIER);
    expect(session).toMatchObject({ accessToken: "at" });
  });

  it("does not retry an unrelated 4xx from the mint", async () => {
    // The exception is narrow on purpose: a retry cannot change a user that
    // does not exist, and hammering the endpoint would only add latency.
    mockSuccessfulMint("sso@acme.com", TEST_CHALLENGE);
    supabaseMocks.generateLink.mockResolvedValue({
      data: null,
      error: {
        __authApiError: true,
        code: "user_not_found",
        status: 404,
        message: "User not found",
      },
    });

    await expect(
      redeemMobileAuthCode("good-code", TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 500 });
    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(1);
  });

  it("retries a transient mint failure, then succeeds", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      user: { email: "sso@acme.com" },
      codeChallenge: TEST_CHALLENGE,
    });
    // First generateLink fails transiently (503); the retry succeeds.
    supabaseMocks.generateLink
      .mockResolvedValueOnce({
        data: null,
        // __retryable → classified as a transient AuthRetryableFetchError
        error: { __retryable: true, status: 503, message: "upstream" },
      })
      .mockResolvedValueOnce({
        data: { properties: { hashed_token: "hash_123" } },
        error: null,
      });
    supabaseMocks.verifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: "at",
          refresh_token: "rt",
          user: { id: "user_1", email: "sso@acme.com" },
          expires_in: 3600,
          expires_at: 9_999_999_999,
        },
      },
      error: null,
    });

    const session = await redeemMobileAuthCode("good-code", TEST_VERIFIER);

    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(2); // retried once
    expect(session).toMatchObject({ accessToken: "at", refreshToken: "rt" });
  });

  it("maps a rate-limit failure to a 429 and does not retry", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      user: { email: "sso@acme.com" },
      codeChallenge: TEST_CHALLENGE,
    });
    supabaseMocks.generateLink.mockResolvedValue({
      data: null,
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });

    await expect(
      redeemMobileAuthCode("good-code", TEST_VERIFIER)
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(1); // no retry
  });

  it("does not retry a deterministic Supabase error (4xx)", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      user: { email: "sso@acme.com" },
      codeChallenge: TEST_CHALLENGE,
    });
    // AuthApiError 4xx (not retryable, not rate-limit) — must fail fast.
    supabaseMocks.generateLink.mockResolvedValue({
      data: null,
      error: { __authApiError: true, status: 422, message: "invalid" },
    });

    await expect(
      redeemMobileAuthCode("good-code", TEST_VERIFIER)
    ).rejects.toMatchObject({
      status: 500,
    });
    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(1); // no retry
  });

  it("refuses a code carrying no PKCE challenge, with or without a verifier", async () => {
    // A challenge-less code is a bearer token: whoever holds the plaintext gets
    // a session. PKCE is the only control standing between an intercepted
    // `shelf://` deeplink and account takeover, so it is mandatory — a code that
    // was minted without a binding can never be redeemed, and presenting a
    // verifier against a NULL challenge does not rescue it either.
    for (const verifier of [undefined, TEST_VERIFIER]) {
      mockSuccessfulMint("sso@acme.com", null);

      await expect(
        redeemMobileAuthCode("good-code", verifier)
      ).rejects.toMatchObject({ status: 400 });
      expect(supabaseMocks.generateLink).not.toHaveBeenCalled();
    }
  });

  it("redeems a PKCE code when the verifier matches the challenge", async () => {
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    mockSuccessfulMint("sso@acme.com", challenge);

    const session = await redeemMobileAuthCode("good-code", verifier);

    expect(session).toMatchObject({ accessToken: "at", refreshToken: "rt" });
  });

  it("rejects a PKCE code with a wrong verifier (400, no mint) but consumes it", async () => {
    const challenge = createHash("sha256")
      .update("r".repeat(64))
      .digest("base64url");
    mockSuccessfulMint("sso@acme.com", challenge);

    await expect(
      redeemMobileAuthCode("good-code", "w".repeat(64))
    ).rejects.toMatchObject({ status: 400 });
    expect(dbMocks.updateMany).toHaveBeenCalledTimes(1); // single-use consume ran
    expect(supabaseMocks.generateLink).not.toHaveBeenCalled(); // never minted
  });

  it("rejects a PKCE code when no verifier is supplied", async () => {
    mockSuccessfulMint("sso@acme.com", TEST_CHALLENGE);

    await expect(redeemMobileAuthCode("good-code")).rejects.toMatchObject({
      status: 400,
    });
    expect(supabaseMocks.generateLink).not.toHaveBeenCalled();
  });
});

describe("deleteExpiredMobileAuthCodes", () => {
  it("deletes only expired rows and returns the count", async () => {
    dbMocks.deleteMany.mockResolvedValue({ count: 3 });

    const count = await deleteExpiredMobileAuthCodes();

    expect(count).toBe(3);
    const { where } = dbMocks.deleteMany.mock.calls[0][0];
    expect(where.expiresAt).toHaveProperty("lt");
  });
});
