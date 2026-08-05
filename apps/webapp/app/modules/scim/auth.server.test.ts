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

// why: the ENABLE_SCIM feature flag is read through the config module; mocking
// it lets us exercise both the enabled and disabled deployments without env vars
const mockConfig = vi.hoisted(() => ({ enableScim: true }));
vi.mock("~/config/shelf.config", () => ({ config: mockConfig }));

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
    mockConfig.enableScim = true;
  });

  describe("when SCIM is disabled on the deployment", () => {
    beforeEach(() => {
      mockConfig.enableScim = false;
    });

    it("should throw 404 even with a valid token", async () => {
      const rawToken = "valid-token";
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      // @ts-expect-error - vitest mock type
      mockDb.db.scimToken.findUnique.mockResolvedValue({
        id: "token-1",
        organizationId: "org-123",
        tokenHash,
      });

      const request = new Request("http://localhost/api/scim/v2/Users", {
        headers: { Authorization: `Bearer ${rawToken}` },
      });

      // Assert the status too, not just the message: 404 is deliberate (a
      // disabled instance must look like one that never had the endpoint), so a
      // regression to 403 would leak that the feature exists.
      await expect(authenticateScimRequest(request)).rejects.toMatchObject({
        status: 404,
        message: expect.stringContaining(
          "SCIM provisioning is not enabled on this instance"
        ),
      });
    });

    it("should short-circuit before touching the database", async () => {
      const request = new Request("http://localhost/api/scim/v2/Users", {
        headers: { Authorization: "Bearer anything" },
      });

      await expect(authenticateScimRequest(request)).rejects.toMatchObject({
        status: 404,
      });

      // A disabled deployment must do no work at all on these paths.
      expect(mockDb.db.scimToken.findUnique).not.toHaveBeenCalled();
      expect(mockDb.db.scimToken.update).not.toHaveBeenCalled();
    });
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
      // Org-scoped write: where includes organizationId (from the resolved token)
      // per the org-scope IDOR convention, in addition to the unique id.
      where: { id: "token-1", organizationId: "org-123" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("should still authenticate when the lastUsedAt write fails", async () => {
    // `lastUsedAt` is observability, not auth state. A transient write failure
    // must not turn a valid provisioning request into a 500, so the update is
    // fire-and-forget with its rejection swallowed.
    // @ts-expect-error - vitest mock type
    mockDb.db.scimToken.findUnique.mockResolvedValue({
      id: "token-1",
      organizationId: "org-123",
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.scimToken.update.mockRejectedValue(new Error("db unavailable"));

    const request = new Request("http://localhost/api/scim/v2/Users", {
      headers: { Authorization: "Bearer some-valid-token" },
    });

    await expect(authenticateScimRequest(request)).resolves.toEqual({
      organizationId: "org-123",
    });
  });
});
