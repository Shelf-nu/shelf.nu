/**
 * Centralized exports for all test factories
 * Use these to generate consistent test data across all tests
 *
 * Each line below is a pointer, not a substitute: the factories carry their
 * own file-level JSDoc explaining the shape they build and why it exists.
 */

/** `createUser` — a User row, plus the shared USER id/email constants. */
export * from "./user";
/** `createTeamMember` — a TeamMember row (the non-registered-member shape). */
export * from "./teamMember";
/** `createAsset`, and `createAssetSearchResult` for the joined index rows. */
export * from "./asset";
/** `createOrganization`, plus the shared ORGANIZATION id constant. */
export * from "./organization";
/** `createAssetModel` — an AssetModel row. */
export * from "./assetModel";
/** `createActivityEventInput` — one `recordEvent` payload. */
export * from "./activityEvent";
/** Audit session + audit asset factories. `createAuditAsset` requires an
 * `auditSessionId`: that link is the model's entire tenant boundary. */
export * from "./audit";
/** `createLayoutLoaderData` — the `_layout` loader payload that
 * `useUserRoleHelper` and friends read through `useRouteLoaderData`. */
export * from "./layoutLoaderData";
/** `stripePriceFactory` + `tierMetadata`/`addonMetadata` — resolved Stripe
 * prices, whose four entitlement-relevant properties must all be set. */
export * from "./stripePrice";
export * from "./scan";
