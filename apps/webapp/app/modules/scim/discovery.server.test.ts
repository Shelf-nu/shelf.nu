import { describe, expect, it } from "vitest";
import {
  buildResourceTypesListResponse,
  buildSchemasListResponse,
  buildServiceProviderConfig,
} from "./discovery.server";
import {
  SCIM_SCHEMA_LIST_RESPONSE,
  SCIM_SCHEMA_RESOURCE_TYPE,
  SCIM_SCHEMA_SCHEMA,
  SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG,
  SCIM_SCHEMA_USER,
} from "./types";

describe("buildServiceProviderConfig", () => {
  it("advertises the features we actually implement", () => {
    const config = buildServiceProviderConfig();

    expect(config.schemas).toEqual([SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG]);
    expect(config.patch.supported).toBe(true);
    expect(config.filter.supported).toBe(true);
    expect(config.filter.maxResults).toBe(100);
    // Not implemented — must be declared unsupported
    expect(config.bulk.supported).toBe(false);
    expect(config.sort.supported).toBe(false);
    expect(config.changePassword.supported).toBe(false);
    expect(config.authenticationSchemes[0].type).toBe("oauthbearertoken");
    expect(config.meta.resourceType).toBe("ServiceProviderConfig");
  });
});

describe("buildResourceTypesListResponse", () => {
  it("returns a ListResponse with a single User resource type", () => {
    const list = buildResourceTypesListResponse();

    expect(list.schemas).toEqual([SCIM_SCHEMA_LIST_RESPONSE]);
    expect(list.totalResults).toBe(1);
    expect(list.Resources).toHaveLength(1);

    const [userType] = list.Resources;
    expect(userType.schemas).toEqual([SCIM_SCHEMA_RESOURCE_TYPE]);
    expect(userType.id).toBe("User");
    expect(userType.endpoint).toBe("/Users");
    expect(userType.schema).toBe(SCIM_SCHEMA_USER);
  });
});

describe("buildSchemasListResponse", () => {
  it("returns the core User schema with the attributes we support", () => {
    const list = buildSchemasListResponse();

    expect(list.schemas).toEqual([SCIM_SCHEMA_LIST_RESPONSE]);
    expect(list.Resources).toHaveLength(1);

    const [userSchema] = list.Resources;
    expect(userSchema.schemas).toEqual([SCIM_SCHEMA_SCHEMA]);
    expect(userSchema.id).toBe(SCIM_SCHEMA_USER);

    const attributeNames = userSchema.attributes.map((a) => a.name);
    expect(attributeNames).toEqual(
      expect.arrayContaining([
        "userName",
        "name",
        "displayName",
        "emails",
        "active",
      ])
    );

    // userName is the required, server-unique login identifier
    const userName = userSchema.attributes.find((a) => a.name === "userName");
    expect(userName?.required).toBe(true);
    expect(userName?.uniqueness).toBe("server");
  });
});
