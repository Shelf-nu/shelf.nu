import { describe, expect, it } from "vitest";
import { ScimError } from "./errors.server";
import {
  parseScimJsonBody,
  scimPatchOpSchema,
  scimUserInputSchema,
} from "./validation.server";

/** Builds a POST-like Request with a JSON string body. */
function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/scim/v2/Users", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/scim+json" },
  });
}

describe("scimUserInputSchema", () => {
  it("accepts a typical Entra create payload and passes through extra fields", () => {
    const parsed = scimUserInputSchema.parse({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "jane@example.com",
      name: { givenName: "Jane", familyName: "Doe" },
      emails: [{ value: "jane@example.com", type: "work", primary: true }],
      active: true,
      externalId: "entra-1",
      // IdP-specific extension the schema must not reject
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
        department: "Eng",
      },
    });

    expect(parsed.userName).toBe("jane@example.com");
    expect(parsed.name?.givenName).toBe("Jane");
  });

  it("allows a missing userName (email may arrive in emails[])", () => {
    const parsed = scimUserInputSchema.parse({
      emails: [{ value: "jane@example.com" }],
    });
    expect(parsed.userName).toBeUndefined();
  });

  it("rejects a wrong-typed field", () => {
    const result = scimUserInputSchema.safeParse({ userName: 42 });
    expect(result.success).toBe(false);
  });
});

describe("scimPatchOpSchema", () => {
  it("accepts title-cased ops and unpathed value objects", () => {
    const parsed = scimPatchOpSchema.parse({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "Replace", value: { active: false } },
        { op: "Add", path: "name.givenName", value: "Jane" },
      ],
    });
    expect(parsed.Operations).toHaveLength(2);
  });

  it("rejects a body with no Operations array", () => {
    const result = scimPatchOpSchema.safeParse({ Operations: "nope" });
    expect(result.success).toBe(false);
  });
});

describe("parseScimJsonBody", () => {
  it("returns the validated body for valid JSON", async () => {
    const body = await parseScimJsonBody(
      jsonRequest(JSON.stringify({ userName: "jane@example.com" })),
      scimUserInputSchema
    );
    expect(body.userName).toBe("jane@example.com");
  });

  it("throws 400 invalidSyntax for non-JSON bodies", async () => {
    await expect(
      parseScimJsonBody(jsonRequest("this is not json"), scimUserInputSchema)
    ).rejects.toMatchObject({ status: 400, scimType: "invalidSyntax" });
  });

  it("throws 400 invalidValue for schema violations", async () => {
    await expect(
      parseScimJsonBody(
        jsonRequest(JSON.stringify({ userName: 123 })),
        scimUserInputSchema
      )
    ).rejects.toMatchObject({ status: 400, scimType: "invalidValue" });
  });

  it("throws a ScimError (not a raw error) so routes render a SCIM 400", async () => {
    await expect(
      parseScimJsonBody(jsonRequest("{"), scimUserInputSchema)
    ).rejects.toBeInstanceOf(ScimError);
  });
});
