export const SCIM_SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_SCHEMA_LIST_RESPONSE =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_SCHEMA_PATCH_OP =
  "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

// Discovery-endpoint schema URNs (RFC 7643 §5–§7)
export const SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";
export const SCIM_SCHEMA_RESOURCE_TYPE =
  "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
export const SCIM_SCHEMA_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:Schema";

export const SCIM_CONTENT_TYPE = "application/scim+json";

export interface ScimName {
  givenName?: string;
  familyName?: string;
  formatted?: string;
}

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimMeta {
  resourceType: "User";
  created: string;
  lastModified: string;
  location: string;
}

export interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails?: ScimEmail[];
  active: boolean;
  meta: ScimMeta;
}

export interface ScimListResponse {
  schemas: [typeof SCIM_SCHEMA_LIST_RESPONSE];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: ScimUser[];
}
