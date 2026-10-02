/**
 * The 5 "simple" advanced-index hydration batches: tags, locations, kits,
 * customFields, reminders. Each is a narrow, org-scoped, typed-Prisma query
 * keyed on a page of asset ids — the streaming rebuild's replacement for the
 * legacy mega-query's equivalent joins on those same relations.
 *
 * Every function here is a plain `(BatchArgs) => Promise<BatchMap<K>>`: no
 * read-limiter, no streaming, no abort handling. The resolver that wraps
 * these (a later task) owns that — these stay pure fetch-and-group so they
 * are trivial to unit test and to reason about independently of the
 * streaming machinery around them.
 *
 * The heavier custody/bookings/barcodes batches, which need raw SQL (jsonb
 * aggregation, custody redaction), live in a separate module — raw SQL is
 * reserved for those three; everything here goes through typed Prisma.
 *
 * @see {@link file://./types.ts} — `BatchArgs`, `BatchMap`, and every `*Lite` shape
 * @see {@link file://../query.server.ts} — the legacy mega-query these batches
 *   replace; the source of truth for each relation's shape and ordering
 */
import { db, type ExtendedPrismaClient } from "~/database/db.server";
import type { ICustomFieldValueJson } from "~/modules/asset/types";
import type {
  BatchArgs,
  BatchMap,
  CustomFieldValueLite,
  KitLite,
  LocationLite,
  ReminderLite,
  TagLite,
} from "./types";

/**
 * Fetches every tag on each of `args.ids`, grouped by asset.
 *
 * Tags are a many-to-many relation (`_AssetToTag`), so this queries from the
 * `Tag` side and reads back which of the requested assets each tag is
 * attached to. Both the tag and the asset legs of that relation are
 * org-scoped independently: `Tag.organizationId` guards against a
 * cross-tenant tag reaching this org's response, and the nested
 * `assets: { organizationId }` filter guards against a caller-supplied asset
 * id from another org matching a tag purely because it happens to share an
 * id collision path — belt-and-suspenders, since `organizationId` is the
 * only boundary a request-supplied `ids` array can be trusted against.
 *
 * @param args - Paged asset ids, the caller's org, and the shared batch inputs
 * @param client - The Prisma client to query through. Defaults to the app's
 *   `db`; real-DB tests and the parity harness pass a fixture-scoped client so
 *   the query runs against the fixture Postgres rather than the module-mocked
 *   `db`. Production callers omit it.
 * @returns Map of assetId → that asset's tags. An asset with no tags is
 *   simply absent from the map (the assembler applies the `[]` default).
 */
export async function fetchTagsBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"tags">> {
  const { ids, organizationId } = args;

  const tags = await client.tag.findMany({
    where: {
      organizationId,
      assets: { some: { id: { in: ids }, organizationId } },
    },
    select: {
      id: true,
      name: true,
      color: true,
      assets: {
        where: { id: { in: ids }, organizationId },
        select: { id: true },
      },
    },
    // Parity-critical ordering. The legacy mega-query aggregates tags with
    // `jsonb_agg(DISTINCT jsonb_build_object('id', …, 'name', …, 'color', …))`,
    // and DISTINCT sorts the aggregated objects by their jsonb value — whose
    // first key ('id') is unique, so the emitted array is ordered by tag id
    // ascending. Iterating id-ascending here and pushing per asset reproduces
    // that same per-asset order, which golden-CSV parity checks against.
    orderBy: { id: "asc" },
  });

  const map: BatchMap<"tags"> = new Map();
  for (const tag of tags) {
    const tagLite: TagLite = { id: tag.id, name: tag.name, color: tag.color };
    for (const asset of tag.assets) {
      const existing = map.get(asset.id);
      if (existing) {
        existing.push(tagLite);
      } else {
        map.set(asset.id, [tagLite]);
      }
    }
  }
  return map;
}

/**
 * Fetches every placement (`AssetLocation` pivot row) for each of
 * `args.ids`, grouped by asset and ordered oldest-pivot-first.
 *
 * The ordering is parity-critical, not cosmetic: the assembler treats
 * element 0 of each asset's array as the "primary" location — the same
 * primary the legacy mega-query's `LEFT JOIN LATERAL … ORDER BY
 * al."createdAt" ASC, al.id ASC LIMIT 1` picks. A different order here would
 * make a different location "primary" than the legacy query does for the
 * same asset, which golden-CSV parity checks would catch as a mismatch.
 *
 * @param args - Paged asset ids, the caller's org, and the shared batch inputs
 * @returns Map of assetId → that asset's placements, oldest first. An asset
 *   with no placements is absent from the map.
 */
export async function fetchLocationsBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"locations">> {
  const { ids, organizationId } = args;

  const rows = await client.assetLocation.findMany({
    where: { assetId: { in: ids }, organizationId },
    select: {
      assetId: true,
      location: {
        select: {
          id: true,
          name: true,
          parentId: true,
          _count: { select: { children: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const map: BatchMap<"locations"> = new Map();
  for (const row of rows) {
    const locationLite: LocationLite = {
      id: row.location.id,
      name: row.location.name,
      parentId: row.location.parentId,
      childCount: row.location._count.children,
    };
    const existing = map.get(row.assetId);
    if (existing) {
      existing.push(locationLite);
    } else {
      map.set(row.assetId, [locationLite]);
    }
  }
  return map;
}

/**
 * Fetches every kit membership (`AssetKit` pivot row) for each of
 * `args.ids`, grouped by asset and ordered oldest-pivot-first.
 *
 * Ordering is parity-critical for the same reason as {@link fetchLocationsBatch}:
 * the assembler's "primary kit" is element 0, matching the legacy
 * mega-query's `ORDER BY ak."createdAt" ASC, ak.id ASC LIMIT 1` primary pick.
 *
 * @param args - Paged asset ids, the caller's org, and the shared batch inputs
 * @returns Map of assetId → that asset's kit memberships, oldest first. An
 *   asset with no kit membership is absent from the map.
 */
export async function fetchKitsBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"kits">> {
  const { ids, organizationId } = args;

  const rows = await client.assetKit.findMany({
    where: { assetId: { in: ids }, organizationId },
    select: {
      assetId: true,
      kit: { select: { id: true, name: true, status: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const map: BatchMap<"kits"> = new Map();
  for (const row of rows) {
    const kitLite: KitLite = {
      id: row.kit.id,
      name: row.kit.name,
      status: row.kit.status,
    };
    const existing = map.get(row.assetId);
    if (existing) {
      existing.push(kitLite);
    } else {
      map.set(row.assetId, [kitLite]);
    }
  }
  return map;
}

/**
 * Fetches active custom-field values for each of `args.ids`, grouped by
 * asset.
 *
 * When `args.requestedFieldIds` is non-empty, only those fields are
 * hydrated (the column-visibility case: a caller asks for just the custom
 * fields the current view actually renders). Otherwise every active custom
 * field value on each asset is fetched, matching the legacy mega-query's
 * unconditional `AssetCustomFieldValue` join.
 *
 * `AssetCustomFieldValue` has no `organizationId` column of its own, so this
 * scopes through both relations that do: the owning `asset` and the
 * `customField` definition. The latter also prevents a caller-supplied
 * `requestedFieldIds` entry from another org from leaking that org's field
 * definition (name, options, help text) into this response.
 *
 * @param args - Paged asset ids, the caller's org, optional field-id filter,
 *   and the shared batch inputs
 * @returns Map of assetId → that asset's custom-field values. An asset with
 *   no matching values is absent from the map.
 */
export async function fetchCustomFieldsBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"customFields">> {
  const { ids, organizationId, requestedFieldIds } = args;

  const rows = await client.assetCustomFieldValue.findMany({
    where: {
      assetId: { in: ids },
      asset: { organizationId },
      customField: {
        active: true,
        organizationId,
        ...(requestedFieldIds && requestedFieldIds.length > 0
          ? { id: { in: requestedFieldIds } }
          : {}),
      },
    },
    select: {
      id: true,
      assetId: true,
      value: true,
      customField: {
        select: {
          id: true,
          name: true,
          helpText: true,
          required: true,
          type: true,
          options: true,
          categories: { select: { id: true, name: true } },
        },
      },
    },
  });

  const map: BatchMap<"customFields"> = new Map();
  for (const row of rows) {
    const valueLite: CustomFieldValueLite = {
      id: row.id,
      // `AssetCustomFieldValue.value` is a Prisma `Json` column — a genuinely
      // dynamic shape whose actual structure depends on `customField.type`.
      // `ICustomFieldValueJson` is the same narrowing every other custom-field
      // value reader in the app applies to it (see `advanced-asset-columns`).
      value: row.value as unknown as ICustomFieldValueJson,
      customField: {
        id: row.customField.id,
        name: row.customField.name,
        helpText: row.customField.helpText,
        required: row.customField.required,
        type: row.customField.type,
        options: row.customField.options,
        categories:
          row.customField.categories.length > 0
            ? row.customField.categories
            : null,
      },
    };
    const existing = map.get(row.assetId);
    if (existing) {
      existing.push(valueLite);
    } else {
      map.set(row.assetId, [valueLite]);
    }
  }
  return map;
}

/**
 * Fetches the single soonest-upcoming reminder for each of `args.ids`.
 *
 * Mirrors the legacy mega-query's `upcomingReminder`: only reminders whose
 * `alertDateTime` is still in the future are eligible, and only the earliest
 * one per asset is kept. Ordering the whole result set by `alertDateTime`
 * ascending and keeping the first row seen per asset is equivalent to
 * picking the minimum per asset — sorting by one column preserves each
 * asset's own rows in ascending order relative to each other.
 *
 * @param args - Paged asset ids, the caller's org, and the shared batch inputs
 * @returns Map of assetId → that asset's soonest reminder. An asset with no
 *   future reminder is absent from the map (the assembler applies `null`).
 */
export async function fetchRemindersBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"reminders">> {
  const { ids, organizationId } = args;

  const rows = await client.assetReminder.findMany({
    where: {
      assetId: { in: ids },
      organizationId,
      alertDateTime: { gte: new Date() },
    },
    select: {
      id: true,
      assetId: true,
      name: true,
      message: true,
      alertDateTime: true,
    },
    orderBy: { alertDateTime: "asc" },
  });

  const map: BatchMap<"reminders"> = new Map();
  for (const row of rows) {
    if (map.has(row.assetId)) {
      // A later row for this asset in ascending alertDateTime order is a
      // later reminder — the first one seen is already the soonest.
      continue;
    }
    const reminderLite: ReminderLite = {
      id: row.id,
      name: row.name,
      message: row.message,
      alertDateTime: row.alertDateTime.toISOString(),
    };
    map.set(row.assetId, reminderLite);
  }
  return map;
}
