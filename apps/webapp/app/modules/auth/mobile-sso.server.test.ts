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

/** Wires the happy-path mocks for a successful redeem + fresh-session mint. */
function mockSuccessfulMint(
  email = "sso@acme.com",
  codeChallenge: string | null = null
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

    await redeemMobileAuthCode("good-code");

    const { where, data } = dbMocks.updateMany.mock.calls[0][0];
    expect(where.consumedAt).toBeNull(); // only unconsumed rows
    expect(where.expiresAt).toHaveProperty("gt"); // only unexpired rows
    expect(data.consumedAt).toBeInstanceOf(Date); // marks it consumed
  });

  it("mints a fresh, independent session via generateLink → verifyOtp", async () => {
    mockSuccessfulMint("sso@acme.com");

    const session = await redeemMobileAuthCode("good-code");

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
    });
    supabaseMocks.generateLink.mockResolvedValue({
      data: { properties: {} }, // no hashed_token
      error: null,
    });

    await expect(redeemMobileAuthCode("good-code")).rejects.toBeInstanceOf(
      ShelfError
    );
    expect(supabaseMocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("retries a transient mint failure, then succeeds", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      user: { email: "sso@acme.com" },
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

    const session = await redeemMobileAuthCode("good-code");

    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(2); // retried once
    expect(session).toMatchObject({ accessToken: "at", refreshToken: "rt" });
  });

  it("maps a rate-limit failure to a 429 and does not retry", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      user: { email: "sso@acme.com" },
    });
    supabaseMocks.generateLink.mockResolvedValue({
      data: null,
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });

    await expect(redeemMobileAuthCode("good-code")).rejects.toMatchObject({
      status: 429,
    });
    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(1); // no retry
  });

  it("does not retry a deterministic Supabase error (4xx)", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      user: { email: "sso@acme.com" },
    });
    // AuthApiError 4xx (not retryable, not rate-limit) — must fail fast.
    supabaseMocks.generateLink.mockResolvedValue({
      data: null,
      error: { __authApiError: true, status: 422, message: "invalid" },
    });

    await expect(redeemMobileAuthCode("good-code")).rejects.toMatchObject({
      status: 500,
    });
    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(1); // no retry
  });

  it("redeems a legacy (no-challenge) code without a verifier", async () => {
    mockSuccessfulMint("sso@acme.com", null); // pre-PKCE app: codeChallenge null

    const session = await redeemMobileAuthCode("good-code"); // no verifier

    expect(session).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    expect(supabaseMocks.generateLink).toHaveBeenCalledTimes(1); // minted
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
      .update("the-real-verifier")
      .digest("base64url");
    mockSuccessfulMint("sso@acme.com", challenge);

    await expect(
      redeemMobileAuthCode("good-code", "a-different-verifier")
    ).rejects.toMatchObject({ status: 400 });
    expect(dbMocks.updateMany).toHaveBeenCalledTimes(1); // single-use consume ran
    expect(supabaseMocks.generateLink).not.toHaveBeenCalled(); // never minted
  });

  it("rejects a PKCE code when no verifier is supplied", async () => {
    const challenge = createHash("sha256")
      .update("verifier")
      .digest("base64url");
    mockSuccessfulMint("sso@acme.com", challenge);

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
