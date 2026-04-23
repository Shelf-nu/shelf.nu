import { describe, expect, it, vi } from "vitest";
import {
  ScimError,
  handleScimError,
  scimErrorResponse,
} from "~/modules/scim/errors.server";
import { SCIM_CONTENT_TYPE, SCIM_SCHEMA_ERROR } from "~/modules/scim/types";

// why: prevent console noise from Logger.error calls in handleScimError
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn() },
}));

describe("ScimError", () => {
  it("should create an error with status and message", () => {
    const err = new ScimError("User not found", 404);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ScimError");
    expect(err.message).toBe("User not found");
    expect(err.status).toBe(404);
    expect(err.scimType).toBeUndefined();
  });

  it("should create an error with scimType", () => {
    const err = new ScimError("Duplicate user", 409, "uniqueness");

    expect(err.status).toBe(409);
    expect(err.scimType).toBe("uniqueness");
  });
});

describe("scimErrorResponse", () => {
  it("should return a SCIM-formatted error response", async () => {
    const err = new ScimError("Not found", 404);
    const response = scimErrorResponse(err);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe(SCIM_CONTENT_TYPE);

    const body = await response.json();
    expect(body).toEqual({
      schemas: [SCIM_SCHEMA_ERROR],
      detail: "Not found",
      status: "404",
    });
  });

  it("should include scimType when present", async () => {
    const err = new ScimError("Conflict", 409, "uniqueness");
    const response = scimErrorResponse(err);
    const body = await response.json();

    expect(body.scimType).toBe("uniqueness");
  });

  it("should omit scimType when not present", async () => {
    const err = new ScimError("Bad request", 400);
    const response = scimErrorResponse(err);
    const body = await response.json();

    expect(body.scimType).toBeUndefined();
  });

  it("should serialize status as a string per RFC 7644", async () => {
    const err = new ScimError("Server error", 500);
    const response = scimErrorResponse(err);
    const body = await response.json();

    expect(typeof body.status).toBe("string");
    expect(body.status).toBe("500");
  });
});

describe("handleScimError", () => {
  it("should pass ScimError through to scimErrorResponse", async () => {
    const err = new ScimError("Token expired", 401);
    const response = handleScimError(err);

    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.detail).toBe("Token expired");
  });

  it("should convert unknown errors to 500 Internal Server Error", async () => {
    const err = new TypeError("Cannot read property 'id' of undefined");
    const response = handleScimError(err);

    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.detail).toBe("Internal server error");
    expect(body.status).toBe("500");
  });

  it("should convert string errors to 500", async () => {
    const response = handleScimError("something broke");

    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.detail).toBe("Internal server error");
  });

  it("should not leak internal error details for non-ScimErrors", async () => {
    const err = new Error("SELECT * FROM secret_table WHERE ...");
    const response = handleScimError(err);
    const body = await response.json();

    expect(body.detail).toBe("Internal server error");
    expect(body.detail).not.toContain("secret_table");
  });
});
