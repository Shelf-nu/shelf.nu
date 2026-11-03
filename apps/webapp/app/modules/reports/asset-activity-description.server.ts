/**
 * Readable change descriptions for Asset Activity Summary rows.
 *
 * Location, category, asset-model and tag change events store record ids in
 * `fromValue` / `toValue`. This module turns them into the words a reader
 * expects ("Location changed: Warehouse → Van 2", "Tags added: Fragile"),
 * resolving every id on a page with one organization-scoped query per record
 * type instead of one per row. The action labels themselves live with the
 * report in `helpers.server.ts`.
 *
 * @see {@link file://./helpers.server.ts} `assetActivityReport`
 */

import type { ActivityAction } from "@prisma/client";

import { db } from "~/database/db.server";
import { sanitizeUnitOfMeasureLabel } from "~/utils/asset-quantity";

/**
 * Kinds of record a change event can point at, with the word used when that
 * record no longer exists.
 */
const REFERENCE_FIELDS = {
  locationId: "location",
  categoryId: "category",
  assetModelId: "asset model",
  tags: "tag",
} as const;

type ReferenceField = keyof typeof REFERENCE_FIELDS;

/**
 * The actions whose values are record ids, and the kind of record. Decided by
 * the action, never by `field`: a custom field event stores the custom
 * field's own name there, and a field may be named "tags".
 */
const REFERENCE_ACTIONS: Partial<Record<ActivityAction, ReferenceField>> = {
  ASSET_LOCATION_CHANGED: "locationId",
  ASSET_CATEGORY_CHANGED: "categoryId",
  ASSET_MODEL_CHANGED: "assetModelId",
  ASSET_TAGS_CHANGED: "tags",
};

/** Names of the records a page of events refers to, keyed by field then id. */
export type ReferenceNames = Record<ReferenceField, Map<string, string>>;

/** The event columns the description reads. */
export type DescribableEvent = {
  action: ActivityAction;
  field?: string | null;
  fromValue?: unknown;
  toValue?: unknown;
  meta?: unknown;
};

/** What a row shows about an event: a sentence plus the two sides of a change. */
export type ActivityDescription = {
  description: string;
  /** Readable value before the change, or `null` when there was none. */
  changedFrom: string | null;
  /** Readable value after the change, or `null` when it was cleared. */
  changedTo: string | null;
};

/**
 * The attribute an action changes, for the one-sided sentences
 * "Location set to X" and "Location removed, was X". Actions not listed
 * keep their plain label when one side is empty. Custom field events name
 * their own attribute: their `field` is the custom field's name.
 */
const CHANGED_ATTRIBUTE: Partial<Record<ActivityAction, string>> = {
  ASSET_DESCRIPTION_CHANGED: "Description",
  ASSET_CATEGORY_CHANGED: "Category",
  ASSET_MODEL_CHANGED: "Asset model",
  ASSET_LOCATION_CHANGED: "Location",
  ASSET_VALUATION_CHANGED: "Valuation",
};

/** The ids an event value holds: one id, a list of ids, or none. */
function idsIn(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && !!v);
  }
  return [];
}

/**
 * Loads the names of every location, category, asset model and tag the
 * events point at: at most one query per record type, each scoped to the
 * workspace so an id from another workspace never resolves.
 *
 * @param organizationId - Workspace the events belong to
 * @param events - The events about to be described
 * @returns Names keyed by field, then id; ids with no row are absent
 */
export async function loadReferenceNames(
  organizationId: string,
  events: DescribableEvent[]
): Promise<ReferenceNames> {
  const ids: Record<ReferenceField, Set<string>> = {
    locationId: new Set(),
    categoryId: new Set(),
    assetModelId: new Set(),
    tags: new Set(),
  };
  for (const event of events) {
    const reference = REFERENCE_ACTIONS[event.action];
    if (!reference) continue;
    for (const id of [...idsIn(event.fromValue), ...idsIn(event.toValue)]) {
      ids[reference].add(id);
    }
  }

  const select = { id: true, name: true } as const;
  const scoped = (set: Set<string>) => ({
    where: { id: { in: [...set] }, organizationId },
    select,
  });
  const [locations, categories, assetModels, tags] = await Promise.all([
    ids.locationId.size > 0 ? db.location.findMany(scoped(ids.locationId)) : [],
    ids.categoryId.size > 0 ? db.category.findMany(scoped(ids.categoryId)) : [],
    ids.assetModelId.size > 0
      ? db.assetModel.findMany(scoped(ids.assetModelId))
      : [],
    ids.tags.size > 0 ? db.tag.findMany(scoped(ids.tags)) : [],
  ]);

  const byId = (rows: { id: string; name: string }[]) =>
    new Map(rows.map((row) => [row.id, row.name]));
  return {
    locationId: byId(locations),
    categoryId: byId(categories),
    assetModelId: byId(assetModels),
    tags: byId(tags),
  };
}

/** The name of one referenced record, or a placeholder once it is deleted. */
function nameOf(field: ReferenceField, id: string, names: ReferenceNames) {
  return names[field].get(id) ?? `(deleted ${REFERENCE_FIELDS[field]})`;
}

/** One side of a change as text, or `null` when that side is empty. */
function readableValue(
  reference: ReferenceField | undefined,
  value: unknown,
  names: ReferenceNames
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (reference) {
    const ids = idsIn(value);
    return ids.length > 0
      ? ids.map((id) => nameOf(reference, id, names)).join(", ")
      : null;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}

/** "Tags added: A; removed: B" from the two tag lists of a tags event. */
function describeTagChange(
  event: DescribableEvent,
  names: ReferenceNames
): string | null {
  const before = new Set(idsIn(event.fromValue));
  const after = new Set(idsIn(event.toValue));
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  const list = (tagIds: string[]) =>
    tagIds.map((id) => nameOf("tags", id, names)).join(", ");

  if (added.length > 0 && removed.length > 0) {
    return `Tags added: ${list(added)}; removed: ${list(removed)}`;
  }
  if (added.length > 0) return `Tags added: ${list(added)}`;
  if (removed.length > 0) return `Tags removed: ${list(removed)}`;
  return null;
}

/** What a location event's `meta` says about the units it moved. */
type UnitMove = {
  /** The count with its unit, e.g. "12 units" or "40 kg". */
  units: string;
  /** Which half of a partial move this event is: "from" or "to". */
  side?: string;
  /** Units placed from the asset's unplaced stock, not moved from a site. */
  fromUnplaced: boolean;
};

/**
 * The units a location event moved, for quantity-tracked assets. Plain assets
 * carry no quantity in `meta`.
 *
 * @param meta - The event's `meta`
 * @param unitOfMeasure - The asset's unit of measure; "unit(s)" when unset
 */
function unitsMoved(
  meta: unknown,
  unitOfMeasure: string | null | undefined
): UnitMove | null {
  if (!meta || typeof meta !== "object") return null;
  const { quantity, side, placeUnplaced } = meta as {
    quantity?: unknown;
    side?: unknown;
    placeUnplaced?: unknown;
  };
  if (typeof quantity !== "number" || quantity <= 0) return null;
  const unit =
    sanitizeUnitOfMeasureLabel(unitOfMeasure) ||
    (quantity === 1 ? "unit" : "units");
  return {
    units: `${quantity.toLocaleString()} ${unit}`,
    side: typeof side === "string" ? side : undefined,
    fromUnplaced: placeUnplaced === true,
  };
}

/** Location sentences for quantity-tracked assets, which move units. */
function describeUnitMove(
  units: UnitMove,
  from: string | null,
  to: string | null
): string | null {
  if (from && to) return `${units.units} moved: ${from} → ${to}`;
  // A partial move records its two halves as separate events.
  if (to) {
    return units.side === "to" && !units.fromUnplaced
      ? `${units.units} moved to ${to}`
      : `${units.units} placed at ${to}`;
  }
  if (from) {
    return units.side === "from"
      ? `${units.units} moved from ${from}`
      : `${units.units} removed from ${from}`;
  }
  return null;
}

/**
 * Describes one event in plain words, with ids replaced by names.
 *
 * @param label - The action's label, e.g. "Location changed"
 * @param event - The event to describe
 * @param names - Names from {@link loadReferenceNames} for the same page
 * @param unitOfMeasure - The asset's unit of measure, for unit moves
 * @returns The sentence plus the readable before and after values
 */
export function describeChange(
  label: string,
  event: DescribableEvent,
  names: ReferenceNames,
  unitOfMeasure?: string | null
): ActivityDescription {
  if (!event.field) {
    return { description: label, changedFrom: null, changedTo: null };
  }

  const reference = REFERENCE_ACTIONS[event.action];
  const changedFrom = readableValue(reference, event.fromValue, names);
  const changedTo = readableValue(reference, event.toValue, names);
  const sides = { changedFrom, changedTo };

  if (event.action === "ASSET_TAGS_CHANGED") {
    return { description: describeTagChange(event, names) ?? label, ...sides };
  }

  const units =
    event.action === "ASSET_LOCATION_CHANGED"
      ? unitsMoved(event.meta, unitOfMeasure)
      : null;
  const unitSentence = units
    ? describeUnitMove(units, changedFrom, changedTo)
    : null;
  if (unitSentence) return { description: unitSentence, ...sides };

  const attribute =
    event.action === "ASSET_CUSTOM_FIELD_CHANGED"
      ? event.field
      : CHANGED_ATTRIBUTE[event.action];

  let description = label;
  if (changedFrom && changedTo) {
    const subject =
      event.action === "ASSET_CUSTOM_FIELD_CHANGED"
        ? `${event.field} changed`
        : label;
    description = `${subject}: ${changedFrom} → ${changedTo}`;
  } else if (attribute && changedTo) {
    description = `${attribute} set to ${changedTo}`;
  } else if (attribute && changedFrom) {
    description = `${attribute} removed, was ${changedFrom}`;
  }

  return { description, ...sides };
}
