import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@server/session";
import { ShelfError } from "~/utils/error";
import {
  createMobileAuthCode,
  deleteExpiredMobileAuthCodes,
  redeemMobileAuthCode,
} from "./mobile-sso.server";
import { refreshAccessToken } from "./service.server";

// why: exercise the service logic without a real database
const dbMocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock("~/database/db.server", () => {
  const db = { mobileAuthCode: dbMocks };
  // The transaction client is the same mocked model, so assertions read one set
  // of calls whichever client the code used.
  return {
    db: {
      ...db,
      $transaction: (fn: (tx: typeof db) => unknown) => fn(db),
    },
  };
});

// why: refreshing a session is a Supabase network call. The tests decide what
// the stored session refreshes into, or how the refresh fails.
vi.mock("./service.server", () => ({
  refreshAccessToken: vi.fn(),
}));

// why: classify a refresh failure as an unreachable Supabase by tagging the
// mock error, rather than constructing a real AuthRetryableFetchError.
vi.mock("@supabase/supabase-js", () => ({
  isAuthRetryableFetchError: (err: unknown) =>
    typeof err === "object" && err !== null && "__retryable" in err,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

/**
 * A valid PKCE pair: `TEST_CHALLENGE` is the S256 hash of `TEST_VERIFIER`.
 *
 * Redemption requires a bound challenge, so every test that expects a session
 * presents one. A challenge-less redemption is pinned as refused below.
 */
const TEST_VERIFIER = "t".repeat(64);
const TEST_CHALLENGE = createHash("sha256")
  .update(TEST_VERIFIER)
  .digest("base64url");

const USER_ID = "user-sso";
const STORED_REFRESH_TOKEN = "sso-refresh-token";

/** The session the stored refresh token refreshes into. */
const REFRESHED: AuthSession = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  userId: USER_ID,
  email: "sso@acme.com",
  expiresIn: 3600,
  expiresAt: 9_999_999_999,
};

/**
 * Mints a real code through `createMobileAuthCode` and arranges for its row to
 * be the one redemption consumes, so encryption runs end to end.
 *
 * @returns the plaintext code and the row as it was written
 */
async function mintedCode({
  storedOverrides = {} as Record<string, unknown>,
} = {}) {
  const code = await createMobileAuthCode({
    userId: USER_ID,
    refreshToken: STORED_REFRESH_TOKEN,
    codeChallenge: TEST_CHALLENGE,
  });
  const row = dbMocks.create.mock.calls.at(-1)?.[0].data;

  dbMocks.updateMany.mockResolvedValue({ count: 1 });
  dbMocks.findUniqueOrThrow.mockResolvedValue({
    userId: row.userId,
    codeChallenge: row.codeChallenge,
    sessionCiphertext: row.sessionCiphertext,
    ...storedOverrides,
  });
  dbMocks.update.mockResolvedValue({});

  return { code, row };
}

describe("createMobileAuthCode", () => {
  it("persists the hash, the challenge, an encrypted session and a future expiry, and returns the plaintext", async () => {
    const before = Date.now();

    const { code, row } = await mintedCode();

    expect(code.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(row.userId).toBe(USER_ID);
    expect(row.codeHash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(row.codeHash).not.toBe(code);
    expect(row.codeChallenge).toBe(TEST_CHALLENGE);
    expect(row.expiresAt.getTime()).toBeGreaterThan(before);
    // Neither the token nor the code is stored in the clear.
    expect(row.sessionCiphertext).toEqual(expect.any(String));
    expect(row.sessionCiphertext).not.toContain(STORED_REFRESH_TOKEN);
    expect(row.sessionCiphertext).not.toContain(code);
  });

  it("encrypts the same token differently every time", async () => {
    const { row: first } = await mintedCode();
    const { row: second } = await mintedCode();

    expect(first.sessionCiphertext).not.toBe(second.sessionCiphertext);
  });
});

describe("redeemMobileAuthCode", () => {
  it("rejects an empty code with a 400 and never touches the database", async () => {
    await expect(redeemMobileAuthCode("")).rejects.toMatchObject({
      status: 400,
    });
    expect(dbMocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid, expired or used code with a uniform 400", async () => {
    dbMocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      redeemMobileAuthCode("bogus", TEST_VERIFIER)
    ).rejects.toMatchObject({
      status: 400,
      message: "Invalid or expired authorization code",
    });
    expect(dbMocks.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("hands over the stored SSO session, refreshed", async () => {
    const { code } = await mintedCode();
    vi.mocked(refreshAccessToken).mockResolvedValue(REFRESHED);

    const session = await redeemMobileAuthCode(code, TEST_VERIFIER);

    expect(refreshAccessToken).toHaveBeenCalledWith(STORED_REFRESH_TOKEN);
    expect(session).toEqual(REFRESHED);
  });

  it("consumes the code atomically and clears the stored session", async () => {
    const { code } = await mintedCode();
    vi.mocked(refreshAccessToken).mockResolvedValue(REFRESHED);

    await redeemMobileAuthCode(code, TEST_VERIFIER);

    const codeHash = createHash("sha256").update(code).digest("hex");
    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ codeHash, consumedAt: null });
    expect(where.expiresAt).toHaveProperty("gt");
    expect(dbMocks.update).toHaveBeenCalledWith({
      where: { codeHash },
      data: { sessionCiphertext: null },
    });
  });

  it("refuses a code carrying no PKCE challenge, and still clears its session", async () => {
    const { code } = await mintedCode({
      storedOverrides: { codeChallenge: null },
    });

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 400 });
    await expect(redeemMobileAuthCode(code)).rejects.toMatchObject({
      status: 400,
    });
    expect(dbMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sessionCiphertext: null } })
    );
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a wrong PKCE verifier", async () => {
    const { code } = await mintedCode();

    await expect(
      redeemMobileAuthCode(code, "w".repeat(64))
    ).rejects.toMatchObject({ status: 400 });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a missing PKCE verifier", async () => {
    const { code } = await mintedCode();

    await expect(redeemMobileAuthCode(code)).rejects.toMatchObject({
      status: 400,
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a row that carries no stored session", async () => {
    const { code } = await mintedCode({
      storedOverrides: { sessionCiphertext: null },
    });

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 400 });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a session that does not decrypt under the presented code", async () => {
    // The row's session was encrypted under another code.
    const { row: other } = await mintedCode();
    const { code } = await mintedCode({
      storedOverrides: { sessionCiphertext: other.sessionCiphertext },
    });

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 400 });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a stored session whose authentication tag was truncated", async () => {
    const { code, row } = await mintedCode();
    const [iv, ciphertext, tag] = row.sessionCiphertext.split(".");
    const shortTag = Buffer.from(tag, "base64url")
      .subarray(0, 4)
      .toString("base64url");
    dbMocks.findUniqueOrThrow.mockResolvedValue({
      userId: USER_ID,
      codeChallenge: TEST_CHALLENGE,
      sessionCiphertext: [iv, ciphertext, shortTag].join("."),
    });

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 400 });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a malformed stored session", async () => {
    const { code } = await mintedCode({
      storedOverrides: { sessionCiphertext: "not.a-valid" },
    });

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses with a 400 when the session was signed out before the exchange", async () => {
    const { code } = await mintedCode();
    vi.mocked(refreshAccessToken).mockRejectedValue(
      new ShelfError({
        cause: { message: "Invalid Refresh Token" },
        message: "Unable to refresh access token.",
        label: "Auth",
      })
    );

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({
      status: 400,
      message: "Invalid or expired authorization code",
    });
  });

  it("reports an unreachable Supabase as a 500", async () => {
    const { code } = await mintedCode();
    vi.mocked(refreshAccessToken).mockRejectedValue(
      new ShelfError({
        cause: { __retryable: true },
        message: "Unable to refresh access token.",
        label: "Auth",
      })
    );

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 500 });
  });

  it("refuses a session that belongs to another auth user", async () => {
    const { code } = await mintedCode();
    vi.mocked(refreshAccessToken).mockResolvedValue({
      ...REFRESHED,
      userId: "someone-else",
    });

    await expect(
      redeemMobileAuthCode(code, TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("wraps a database failure in a captured 500", async () => {
    dbMocks.updateMany.mockRejectedValue(new Error("connection lost"));

    await expect(
      redeemMobileAuthCode("some-code", TEST_VERIFIER)
    ).rejects.toMatchObject({ status: 500 });
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
