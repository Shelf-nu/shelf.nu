/**
 * SCIM protocol constants and response types
 *
 * The schema URNs and the shapes Shelf serialises *back* to an identity
 * provider (Entra ID, Okta). These describe SCIM's own wire format, not Shelf's
 * domain model — `mappers.server.ts` translates between the two.
 *
 * Note the direction: types here are OUTBOUND. Inbound request bodies are
 * described by the Zod schemas in `validation.server.ts`, whose inferred types
 * are the runtime contract for anything an IdP sends us.
 *
 * Every SCIM resource carries a `schemas` array naming its URN(s); IdPs use it
 * to decide how to parse the payload, so the constants below are part of the
 * protocol rather than cosmetic labels.
 *
 * @see {@link file://./mappers.server.ts}
 * @see {@link file://./validation.server.ts}
 * @see https://www.rfc-editor.org/rfc/rfc7643 (core schema)
 * @see https://www.rfc-editor.org/rfc/rfc7644 (protocol)
 */

/** URN identifying a SCIM User resource (RFC 7643 §4.1). */
export const SCIM_SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";

/** URN for a paginated query result envelope (RFC 7644 §3.4.2). */
export const SCIM_SCHEMA_LIST_RESPONSE =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse";

/** URN for a PATCH request body (RFC 7644 §3.5.2). */
export const SCIM_SCHEMA_PATCH_OP =
  "urn:ietf:params:scim:api:messages:2.0:PatchOp";

/** URN for an error response body (RFC 7644 §3.12). */
export const SCIM_SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

// Discovery-endpoint schema URNs (RFC 7643 §5–§7)

/** URN for the `/ServiceProviderConfig` document (RFC 7643 §5). */
export const SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";

/** URN for entries in the `/ResourceTypes` collection (RFC 7643 §6). */
export const SCIM_SCHEMA_RESOURCE_TYPE =
  "urn:ietf:params:scim:schemas:core:2.0:ResourceType";

/** URN for entries in the `/Schemas` collection (RFC 7643 §7). */
export const SCIM_SCHEMA_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:Schema";

/**
 * The media type every SCIM response must carry (RFC 7644 §3.1).
 *
 * Not `application/json` — some IdP connectors reject a response whose
 * Content-Type isn't the SCIM one.
 */
export const SCIM_CONTENT_TYPE = "application/scim+json";

/**
 * A user's name components (RFC 7643 §4.1.1).
 *
 * All optional: SCIM treats names as best-effort, and Shelf's `firstName` /
 * `lastName` may be null for a user provisioned before their first SSO login.
 */
export interface ScimName {
  /** Given (first) name — maps to Shelf's `User.firstName`. */
  givenName?: string;
  /** Family (last) name — maps to Shelf's `User.lastName`. */
  familyName?: string;
  /** Full display form; omitted when it would merely repeat the email. */
  formatted?: string;
}

/**
 * One entry in a user's multi-valued `emails` attribute (RFC 7643 §4.1.2).
 *
 * Shelf stores exactly one address per user, so responses always carry a single
 * entry flagged `primary`.
 */
export interface ScimEmail {
  /** The email address itself. */
  value: string;
  /** Address classification, e.g. `"work"`. */
  type?: string;
  /** Whether this is the user's primary address. */
  primary?: boolean;
}

/**
 * Resource metadata returned on every SCIM resource (RFC 7643 §3.1).
 */
export interface ScimMeta {
  /** Always `"User"` — Shelf exposes no other SCIM resource type. */
  resourceType: "User";
  /** Creation timestamp, ISO 8601. */
  created: string;
  /** Last-modified timestamp, ISO 8601. */
  lastModified: string;
  /** Absolute URL of this resource, e.g. `https://…/api/scim/v2/Users/{id}`. */
  location: string;
}

/**
 * A SCIM User resource as returned to the IdP (RFC 7643 §4.1).
 *
 * `id` is the per-org external id (the IdP's own object id), NOT Shelf's
 * `User.id` — the latter is rewritten to the Supabase auth UUID on first SSO
 * login, which would stale every id the IdP had cached. See
 * {@link file://./mappers.server.ts}.
 */
export interface ScimUser {
  /** Schema URNs describing this resource; contains {@link SCIM_SCHEMA_USER}. */
  schemas: string[];
  /** Stable SCIM resource id — the per-org external id, never `User.id`. */
  id: string;
  /** The IdP's identifier for this user; equal to `id` in Shelf's mapping. */
  externalId?: string;
  /** The user's login identifier — their email address in Shelf. */
  userName: string;
  /** Name components, when known. */
  name?: ScimName;
  /** Human-readable name, falling back to the email. */
  displayName?: string;
  /** The user's addresses; Shelf returns exactly one. */
  emails?: ScimEmail[];
  /**
   * Whether the user currently has access to the token's organization.
   *
   * Derived from the presence of a `UserOrganization` row, not stored: a
   * deactivated user keeps their SCIM mapping so they remain addressable and
   * can be reactivated.
   */
  active: boolean;
  /** Resource metadata (timestamps, canonical location). */
  meta: ScimMeta;
}

/**
 * A paginated list of users returned from `GET /Users` (RFC 7644 §3.4.2).
 *
 * SCIM pagination is 1-based: `startIndex` is the index of the first result,
 * not an offset.
 */
export interface ScimListResponse {
  /** Always exactly {@link SCIM_SCHEMA_LIST_RESPONSE}. */
  schemas: [typeof SCIM_SCHEMA_LIST_RESPONSE];
  /** Total matching resources across all pages. */
  totalResults: number;
  /** 1-based index of the first resource in this page. */
  startIndex: number;
  /** Number of resources actually returned in this page. */
  itemsPerPage: number;
  /** The page of resources. Capitalised per the SCIM spec. */
  Resources: ScimUser[];
}
