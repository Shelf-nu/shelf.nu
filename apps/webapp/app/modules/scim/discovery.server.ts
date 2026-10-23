/**
 * SCIM discovery documents (RFC 7643 §5–§7)
 *
 * Builds the static capability metadata IdPs read before/while provisioning:
 *
 *  - `/ServiceProviderConfig` — which SCIM features this server supports
 *  - `/ResourceTypes`         — the resource types exposed (just `User`)
 *  - `/Schemas`               — the attribute definitions for those types
 *
 * Entra ID's user-provisioning flow works without these, but Okta (and Entra
 * group sync) fetch them during connector setup, so exposing them widens IdP
 * compatibility. The documents are org-agnostic capability metadata — no tenant
 * data — but the routes still require the org's bearer token, matching the
 * `/Users` endpoints.
 *
 * @see {@link file://./../../routes/api+/scim+/v2+/ServiceProviderConfig.ts}
 * @see {@link file://./../../routes/api+/scim+/v2+/ResourceTypes.ts}
 * @see {@link file://./../../routes/api+/scim+/v2+/Schemas.ts}
 */
import { SERVER_URL } from "~/utils/env";
import {
  SCIM_SCHEMA_LIST_RESPONSE,
  SCIM_SCHEMA_RESOURCE_TYPE,
  SCIM_SCHEMA_SCHEMA,
  SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG,
  SCIM_SCHEMA_USER,
} from "./types";

/** Base URL for all SCIM v2 endpoints, e.g. `https://app.shelf.nu/api/scim/v2`. */
const SCIM_BASE_URL = `${SERVER_URL}/api/scim/v2`;

/** Documentation link surfaced in the ServiceProviderConfig. */
const SCIM_DOCS_URL = "https://docs.shelf.nu/";

/**
 * Builds the ServiceProviderConfig resource (RFC 7643 §5).
 *
 * Declares the features this server actually implements: PATCH and filtering
 * are supported; bulk, sort, ETag and password change are not.
 */
export function buildServiceProviderConfig() {
  return {
    schemas: [SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG],
    documentationUri: SCIM_DOCS_URL,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description:
          "Authentication via the long-lived SCIM bearer token issued in the Shelf workspace settings.",
        specUri: "https://www.rfc-editor.org/info/rfc6750",
        documentationUri: SCIM_DOCS_URL,
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: `${SCIM_BASE_URL}/ServiceProviderConfig`,
    },
  };
}

/** The single resource type this server exposes: `User`. */
function buildUserResourceType() {
  return {
    schemas: [SCIM_SCHEMA_RESOURCE_TYPE],
    id: "User",
    name: "User",
    endpoint: "/Users",
    description: "User Account",
    schema: SCIM_SCHEMA_USER,
    meta: {
      resourceType: "ResourceType",
      location: `${SCIM_BASE_URL}/ResourceTypes/User`,
    },
  };
}

/**
 * Builds the ResourceTypes ListResponse (RFC 7643 §6).
 * Shelf provisions users only, so the list contains a single `User` entry.
 */
export function buildResourceTypesListResponse() {
  const resources = [buildUserResourceType()];
  return {
    schemas: [SCIM_SCHEMA_LIST_RESPONSE],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/**
 * The core User schema definition (RFC 7643 §8.7.1), limited to the attributes
 * Shelf actually reads/writes. `externalId` is a common attribute (defined at
 * the resource level, not here) so it is intentionally omitted.
 */
function buildUserSchema() {
  return {
    schemas: [SCIM_SCHEMA_SCHEMA],
    id: SCIM_SCHEMA_USER,
    name: "User",
    description: "User Account",
    attributes: [
      {
        name: "userName",
        type: "string",
        multiValued: false,
        description:
          "Unique identifier for the User, used to log in. Maps to the Shelf email.",
        required: true,
        caseExact: false,
        mutability: "readWrite",
        returned: "default",
        uniqueness: "server",
      },
      {
        name: "name",
        type: "complex",
        multiValued: false,
        description: "The components of the user's name.",
        required: false,
        mutability: "readWrite",
        returned: "default",
        uniqueness: "none",
        subAttributes: [
          {
            name: "formatted",
            type: "string",
            multiValued: false,
            required: false,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "none",
          },
          {
            name: "givenName",
            type: "string",
            multiValued: false,
            required: false,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "none",
          },
          {
            name: "familyName",
            type: "string",
            multiValued: false,
            required: false,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "none",
          },
        ],
      },
      {
        name: "displayName",
        type: "string",
        multiValued: false,
        description: "The name of the User, suitable for display.",
        required: false,
        caseExact: false,
        mutability: "readWrite",
        returned: "default",
        uniqueness: "none",
      },
      {
        name: "emails",
        type: "complex",
        multiValued: true,
        description: "Email addresses for the User.",
        required: false,
        mutability: "readWrite",
        returned: "default",
        uniqueness: "none",
        subAttributes: [
          {
            name: "value",
            type: "string",
            multiValued: false,
            required: false,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "none",
          },
          {
            name: "type",
            type: "string",
            multiValued: false,
            required: false,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "none",
          },
          {
            name: "primary",
            type: "boolean",
            multiValued: false,
            required: false,
            mutability: "readWrite",
            returned: "default",
          },
        ],
      },
      {
        name: "active",
        type: "boolean",
        multiValued: false,
        description:
          "A Boolean value indicating the User's administrative status.",
        required: false,
        mutability: "readWrite",
        returned: "default",
      },
    ],
    meta: {
      resourceType: "Schema",
      location: `${SCIM_BASE_URL}/Schemas/${SCIM_SCHEMA_USER}`,
    },
  };
}

/**
 * Builds the Schemas ListResponse (RFC 7643 §7).
 * Contains the single core User schema Shelf supports.
 */
export function buildSchemasListResponse() {
  const resources = [buildUserSchema()];
  return {
    schemas: [SCIM_SCHEMA_LIST_RESPONSE],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}
