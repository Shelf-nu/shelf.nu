export const SCIM_SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_SCHEMA_LIST_RESPONSE =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_SCHEMA_PATCH_OP =
  "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

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

export interface ScimPatchOperation {
  op: "replace" | "add" | "remove";
  path?: string;
  value?: unknown;
}

export interface ScimPatchOp {
  schemas: [typeof SCIM_SCHEMA_PATCH_OP];
  Operations: ScimPatchOperation[];
}

/** The shape of a SCIM User resource in a POST/PUT request body */
export interface ScimUserInput {
  schemas?: string[];
  externalId?: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails?: ScimEmail[];
  active?: boolean;
}
