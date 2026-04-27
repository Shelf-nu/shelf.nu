import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: testing auth logic without actual database lookups
vi.mock("~/database/db.server", () => ({
  db: {
    scimToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockDb = await import("~/database/db.server");

import {
  authenticateScimRequest,
  generateScimToken,
} from "~/modules/scim/auth.server";
import { ScimError } from "~/modules/scim/errors.server";

describe("generateScimToken", () => {
  it("should return a rawToken and tokenHash", () => {
    const { rawToken, tokenHash } = generateScimToken();

    expect(typeof rawToken).toBe("string");
    expect(typeof tokenHash).toBe("string");
    expect(rawToken.length).toBe(64); // 32 bytes as hex
    expect(tokenHash.length).toBe(64); // SHA-256 hex digest
  });

  it("should produce a tokenHash that is the SHA-256 of rawToken", () => {
    const { rawToken, tokenHash } = generateScimToken();
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");

    expect(tokenHash).toBe(expectedHash);
  });

  it("should generate unique tokens on each call", () => {
    const first = generateScimToken();
    const second = generateScimToken();

    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });
});

describe("authenticateScimRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw 401 when Authorization header is missing", async () => {
    const request = new Request("http://localhost/api/scim/v2/Users");

    await expect(authenticateScimRequest(request)).rejects.toThrow(ScimError);
    await expect(authenticateScimRequest(request)).rejects.toThrow(
      "Authentication required"
    );
  });

  it("should throw 401 when Authorization header is not a Bearer token", async () => {
    const request = new Request("http://localhost/api/scim/v2/Users", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });

    await expect(authenticateScimRequest(request)).rejects.toThrow(ScimError);
  });

  it("should throw 401 when token is not found in database", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.scimToken.findUnique.mockResolvedValue(null);

    const request = new Request("http://localhost/api/scim/v2/Users", {
      headers: { Authorization: "Bearer invalid-token" },
    });

    await expect(authenticateScimRequest(request)).rejects.toThrow(
      "Invalid token"
    );
  });

  it("should return organizationId when token is valid", async () => {
    const rawToken = "valid-test-token";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    // @ts-expect-error - vitest mock type
    mockDb.db.scimToken.findUnique.mockResolvedValue({
      id: "token-1",
      organizationId: "org-123",
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.scimToken.update.mockResolvedValue({});

    const request = new Request("http://localhost/api/scim/v2/Users", {
      headers: { Authorization: `Bearer ${rawToken}` },
    });

    const result = await authenticateScimRequest(request);

    expect(result).toEqual({ organizationId: "org-123" });
    expect(mockDb.db.scimToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash },
      select: { id: true, organizationId: true },
    });
  });

  it("should update lastUsedAt", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.scimToken.findUnique.mockResolvedValue({
      id: "token-1",
      organizationId: "org-123",
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.scimToken.update.mockResolvedValue({});

    const request = new Request("http://localhost/api/scim/v2/Users", {
      headers: { Authorization: "Bearer some-valid-token" },
    });

    await authenticateScimRequest(request);

    expect(mockDb.db.scimToken.update).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
