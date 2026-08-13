/**
 * Permission vocabulary + role matrix — thin re-export shim.
 *
 * The canonical source is the `@shelf/permissions` workspace package, so the
 * webapp (server + client validators) and the mobile companion resolve
 * permissions from ONE definition. This file only forwards it. The Prisma
 * role parity guard that used to live here moved to
 * `./permission.roles-parity.ts`.
 *
 * ## Why this shim still exists
 *
 * It was going to be deleted, with all ~270 import sites rewritten to
 * `@shelf/permissions` directly so provenance is visible at every call site.
 * That rewrite typechecks in isolation but tips the webapp program over
 * TypeScript's type-instantiation ceiling:
 *
 *     error TS2321: Excessive stack depth comparing types
 *     'UserDefaultArgs<DefaultArgs>' and
 *     'UserDefaultArgs<InternalArgs & { … 58 more … }>'
 *
 * The depth comes from `@shelf/database` `$extends`-ing the Prisma client
 * across every model; those arg types already sit close to the limit, and the
 * extra direct edges push them past it. The error is NOT in permissions code
 * — it lands on whichever Prisma query is deepest when the budget runs out
 * (it moved between the organization and asset service files as call sites
 * were patched), so patching call sites is unbounded, not a fix.
 *
 * Bisected to confirm: keeping this shim is green, deleting it is not. The
 * package split, the client-validator migration and the parity guard were
 * each verified green independently — none of them is the trigger.
 *
 * Deleting this file is still the right end state. It needs the headroom
 * problem fixed first, in `@shelf/database` (a shallower exported client
 * type), which has far wider blast radius than this PR.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
 * @see {@link file://./permission.roles-parity.ts} — the Prisma role parity guard
 */
export {
  PermissionAction,
  PermissionEntity,
  Role2PermissionMap,
} from "@shelf/permissions";
