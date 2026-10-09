/**
 * Shared type system for the advanced asset index's streaming hydration.
 *
 * The advanced index paginates assets first (a slim, fast query) and then
 * hydrates each row's relations — tags, locations, kits, custom fields,
 * reminders, custody, bookings, barcodes — as separate batch queries keyed on
 * the paged asset ids. This file is the single place every later piece of the
 * feature (batch fetchers, the resolver, the loader, the client) imports its
 * types from, so a shape defined here is a contract those pieces share
 * verbatim rather than each re-deriving their own.
 *
 * Every `*Lite` type is a deliberately narrowed projection of what the
 * legacy mega-query (`~/modules/asset/query.server`) emits for that relation
 * and what the advanced-index cells (`~/components/assets/assets-index/advanced-asset-columns`)
 * read from it — carrying neither less (a cell would render blank) nor more
 * (unused columns cost query and payload weight for nothing). None of them
 * carry `email`: custody and booking custodians are shown as a name and
 * picture only, never an address, on this surface.
 *
 * @see {@link file://./hydrate-simple.server.ts} — the 5 typed-Prisma batches
 *   this file's types describe (tags, locations, kits, customFields, reminders).
 * @see {@link file://./hydrate-heavy.server.ts} — the 3 remaining batches
 *   (custody, bookings, barcodes): raw SQL for the first two, typed Prisma
 *   gated on an entitlement flag for the third.
 * @see {@link file://./deadlines.ts} — the streaming clocks these batches race.
 */
import type {
  AssetStatus,
  AssetType,
  BarcodeType,
  Booking,
  BookingStatus,
  Category,
  ConsumptionType,
  CustomFieldType,
  KitStatus,
} from "@prisma/client";
import type { ICustomFieldValueJson } from "~/modules/asset/types";

/**
 * Identifies which viewer a row is being hydrated for.
 *
 * Custody data is redacted for viewers who lack the org-wide custody-view
 * permission — they see only custody assigned to themselves. The heavy
 * custody batch (built in a later task) reads this to decide what to return;
 * the type lives here so every batch signature carries it uniformly.
 */
export type ViewerScope = { userId: string; canSeeAllCustody: boolean };

/** The 8 hydration columns a row can be enriched with, by key. */
export type BatchKey =
  | "tags"
  | "locations"
  | "kits"
  | "customFields"
  | "reminders"
  | "custody"
  | "bookings"
  | "barcodes";

/**
 * Inputs every hydration batch fetch takes, regardless of which column it
 * fetches.
 */
export type BatchArgs = {
  /** The paged asset ids to hydrate (≤100 — one index page). */
  ids: string[];
  /** The caller's active organization. Every batch query filters on this —
   * `ids` originates from request input and must never be trusted alone to
   * scope a tenant boundary. */
  organizationId: string;
  /** The viewer being hydrated for; drives custody redaction. */
  viewerScope: ViewerScope;
  /** Whether the org has the barcode entitlement enabled — gates the
   * barcodes batch and the per-type barcode columns. */
  barcodesEnabled: boolean;
  /** Custom-field ids to hydrate. Only meaningful to the customFields batch;
   * when omitted or empty, that batch hydrates every active custom field on
   * each asset instead of a caller-chosen subset. */
  requestedFieldIds?: string[];
};

/** A single tag chip on an asset row. */
export type TagLite = {
  id: string;
  name: string;
  color: string | null;
};

/**
 * A single placement — one row of the `AssetLocation` pivot, resolved to its
 * `Location`. `childCount` is the number of direct child locations, used by
 * `LocationBadge` to render a "contains N locations" affordance.
 */
export type LocationLite = {
  id: string;
  name: string;
  parentId: string | null;
  childCount: number;
};

/**
 * A single kit membership — one row of the `AssetKit` pivot, resolved to its
 * `Kit`. Also doubles as the shape of a `CriticalRow`/`HydratedAsset`'s
 * primary `kit` field (the oldest pivot row), so this is the one place the
 * kit-chip shape is declared.
 */
export type KitLite = {
  id: string;
  name: string;
  status: KitStatus;
};

/**
 * One custom-field value on an asset, paired with the field definition that
 * renders it (type, options, help text). `value` stays the same dynamic JSON
 * envelope every custom-field value cell already narrows via
 * {@link ICustomFieldValueJson} — its shape depends on `customField.type`.
 */
export type CustomFieldValueLite = {
  id: string;
  value: ICustomFieldValueJson;
  customField: {
    id: string;
    name: string;
    helpText: string | null;
    required: boolean;
    type: CustomFieldType;
    options: string[];
    /** `null` when the field is not scoped to any category (applies to every
     * asset), mirroring the mega-query's `jsonb_agg` producing SQL NULL for
     * no matching rows rather than an empty array. */
    categories: Array<{ id: string; name: string }> | null;
  };
};

/**
 * The single soonest-upcoming reminder for an asset (`alertDateTime` in the
 * future, earliest first — never a full reminder history). `alertDateTime`
 * is a formatted string, not a `Date`: it mirrors the legacy mega-query's
 * `to_char`-formatted `json_agg` output, which every consumer of this column
 * (via `DateS`) already expects.
 */
export type ReminderLite = {
  id: string;
  name: string;
  message: string;
  alertDateTime: string;
};

/**
 * One custodian's hold on (all or part of) an asset. Either a direct `Custody`
 * row, or the single booking-derived custodian synthesised for a `CHECKED_OUT`
 * asset that has no direct custody but an active booking — both share this
 * shape so one redaction pass covers both. `CustodyColumn`'s cell (and its `+N`
 * tooltip) reads exactly this shape.
 *
 * Mirrors the legacy mega-query's custody projection field-for-field, including
 * that the booking-derived entry carries no `quantity` (a booking holds the
 * whole asset, not a slice).
 */
export type CustodyLite = {
  /** Custodian display name, mirrored at this level so callers don't need to
   * descend into `custodian` for it. */
  name?: string;
  /** Units of the asset this custody row covers — meaningful only for
   * QUANTITY_TRACKED assets split across multiple direct custodians. Absent on
   * a booking-derived entry. */
  quantity?: number;
  custodian: {
    name: string;
    user: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      profilePicture: string | null;
    } | null;
  };
};

/**
 * One active/upcoming booking that includes this asset (`RESERVED`,
 * `ONGOING`, or `OVERDUE` — the legacy mega-query's own status filter). One
 * entry per `BookingAsset` slice, not per booking, so an asset booked in two
 * slices of the same booking (e.g. a standalone row plus a kit-driven row)
 * produces two entries.
 *
 * Mirrors the legacy mega-query's `bookings` projection field-for-field;
 * `UpcomingBookingsColumn`'s cell reads exactly this shape. `from`/`to` stay
 * strings: `Booking.from`/`to` are `timestamptz` columns, and the query
 * serializes them via `jsonb_build_object` without a `to_char` wrapper, so
 * the emitted value is already a string.
 */
export type BookingLite = Pick<Booking, "id" | "name" | "description"> & {
  status: BookingStatus;
  from: string;
  to: string;
  tags: Array<{ id: string; name: string }>;
  custodianTeamMember: {
    id: string;
    name: string;
    user: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      profilePicture: string | null;
    } | null;
  } | null;
  custodianUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    profilePicture: string | null;
  } | null;
  creator: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    profilePicture: string | null;
  } | null;
  /** `BookingAsset.assetKitId` of THIS slice: `null` = standalone (free
   * pool), non-null = kit-driven (FK → `AssetKit.id`). */
  assetKitId: string | null;
  /** `BookingAsset.quantity` — booked units for THIS slice. Never
   * `Asset.quantity` (workspace stock). */
  quantity: number | null;
  /** Kit name for THIS slice (`null` when standalone), resolved via
   * `AssetKit` → `Kit.name`. */
  kitName: string | null;
};

/**
 * A single barcode on an asset.
 *
 * Mirrors the legacy mega-query's `barcodes` projection; `BarcodeCell` reads
 * only these three fields.
 */
export type BarcodeLite = {
  id: string;
  type: BarcodeType;
  value: string;
};

/** The value type produced for each hydration column, keyed by {@link BatchKey}. */
export type BatchValueByKey = {
  tags: TagLite[];
  locations: LocationLite[];
  kits: KitLite[];
  customFields: CustomFieldValueLite[];
  reminders: ReminderLite | null;
  /** `null` when the asset has no custodian at all — distinct from `[]`,
   * which would mean "known to have zero custodians" (this column never
   * produces that state; absence IS the no-custodian signal). */
  custody: CustodyLite[] | null;
  bookings: BookingLite[];
  barcodes: BarcodeLite[];
};

/**
 * Maps an asset id to its value for hydration column `K`. An asset present
 * in the batch's requested `ids` but absent from this map had no rows for
 * that column — the assembler (Task 8) applies the column's empty default
 * (`[]` for arrays, `null` for `reminders`/`custody`) rather than the batch
 * pre-seeding one.
 */
export type BatchMap<K extends BatchKey> = Map<string, BatchValueByKey[K]>;

/**
 * What an index-page loader streams to the client: one unresolved promise
 * per hydration column it requested (a column the current view doesn't show
 * is simply absent, not an empty promise).
 */
export type HydrationSources = { [K in BatchKey]?: Promise<BatchMap<K>> };

/**
 * What the client holds once a loader's {@link HydrationSources} promises
 * have resolved — the same columns, now settled maps instead of promises.
 */
export type ResolvedHydration = { [K in BatchKey]?: BatchMap<K> };

/**
 * The eagerly-available row for one asset on the advanced index — everything
 * the critical (non-deferred) phase of the page needs, before any hydration
 * batch has resolved. Built and returned by Task 10's critical-page query;
 * declared here so the assembler (Task 8) and the critical query share one
 * definition.
 *
 * Deliberately NOT the `AdvancedIndexAsset` Pick: that legacy type's `kit`
 * omits `status`, which the kit column's badge needs. `kit` here is the
 * primary (oldest pivot row) kit membership — same convention as
 * `AdvancedIndexAsset.kit` — typed as {@link KitLite} so the primary and the
 * full `kits` array (added by the assembler) share one shape.
 */
export type CriticalRow = {
  id: string;
  title: string;
  description: string | null;
  /** Emitted as a `utcJsonTimestamp` string, NOT a `Date` — the legacy
   * mega-query serializes it that way, so both the flag-ON critical query
   * (Task 10, via `utcJsonTimestamp`) and the flag-OFF legacy adapter (Task 11)
   * hand the client the same string. The uniform-client-shape constraint
   * forbids the two paths diverging on this. `DateS` consumes the string. */
  createdAt: string;
  updatedAt: string;
  userId: string;
  mainImage: string | null;
  thumbnailImage: string | null;
  /** String, not `Date`, for the same reason as `createdAt`. `resolveAssetImage`
   * already reads the legacy string form of this column. */
  mainImageExpiration: string | null;
  categoryId: string | null;
  organizationId: string;
  status: AssetStatus;
  type: AssetType;
  valuation: number | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  minQuantity: number | null;
  consumptionType: ConsumptionType | null;
  availableToBook: boolean;
  sequentialId: string | null;
  /** The asset's QR code id. Always present — every asset gets one QR code
   * on creation. */
  qrId: string;
  assetModelId?: string | null;
  assetModelName?: string | null;
  /** The model's cover image, used when the asset has none of its own.
   * Shaped as the nested relation Prisma selects return so
   * `resolveAssetImage` takes the same input on both index modes. */
  assetModel: { image: string | null; thumbnailImage: string | null } | null;
  category: Pick<Category, "id" | "name" | "color"> | null;
  kit: KitLite | null;
};

/**
 * A fully-merged advanced-index row: a {@link CriticalRow} plus every
 * hydration column resolved to its actual value. This is what
 * `useAssetAvailabilityData` and the advanced-index cells read once the
 * assembler (Task 8) has merged a row's streamed batches onto its critical
 * data.
 *
 * Mirrors the legacy mega-query's emitted asset shape: a primary `kit` /
 * `location` (the oldest pivot row, singular) alongside the full `kits` /
 * `locations` arrays, so a multi-kit or multi-location QUANTITY_TRACKED
 * asset can render "primary + N more" without every caller re-deriving the
 * primary from the array itself.
 */
export type HydratedAsset = CriticalRow & {
  tags: TagLite[];
  /** Primary placement (oldest `AssetLocation` pivot row) — mirrors `kit`. */
  location: LocationLite | null;
  locations: LocationLite[];
  kits: KitLite[];
  customFields: CustomFieldValueLite[];
  reminders: ReminderLite | null;
  custody: CustodyLite[] | null;
  bookings: BookingLite[];
  barcodes: BarcodeLite[];
};
