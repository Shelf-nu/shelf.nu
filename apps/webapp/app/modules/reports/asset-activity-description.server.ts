/**
 * Readable change descriptions for Asset Activity Summary rows.
 *
 * Location, category and asset-model change events store record ids in
 * `fromValue` / `toValue`. This module turns them into the words a reader
 * expects ("Location changed: Warehouse → Van 2", "Location set to Van 2"),
 * resolving every id on a page with one organization-scoped query per record
 * type instead of one per row. The action labels themselves live with the
 * report in `helpers.server.ts`.
 *
 * @see {@link file://./helpers.server.ts} `assetActivityReport`
 */

import type { ActivityAction } from "@prisma/client";

import { db } from "~/database/db.server";

/**
 * Event fields whose values are ids of another record in the workspace, with
 * the word used when that record no longer exists.
 */
const REFERENCE_FIELDS = {
  locationId: "location",
  categoryId: "category",
  assetModelId: "asset model",
} as const;

type ReferenceField = keyof typeof REFERENCE_FIELDS;

/** Names of the records a page of events refers to, keyed by field then id. */
export type ReferenceNames = Record<ReferenceField, Map<string, string>>;

/** The event columns the description reads. */
export type DescribableEvent = {
  action: ActivityAction;
  field?: string | null;
  fromValue?: unknown;
  toValue?: unknown;
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
 * keep their plain label when one side is empty.
 */
const CHANGED_ATTRIBUTE: Partial<Record<ActivityAction, string>> = {
  ASSET_CATEGORY_CHANGED: "Category",
  ASSET_MODEL_CHANGED: "Asset model",
  ASSET_LOCATION_CHANGED: "Location",
  ASSET_VALUATION_CHANGED: "Valuation",
};

function isReferenceField(field: string): field is ReferenceField {
  return Object.hasOwn(REFERENCE_FIELDS, field);
}

/**
 * Loads the names of every location, category and asset model the events
 * point at: at most one query per record type, each scoped to the workspace so
 * an id from another workspace never resolves.
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
  };
  for (const event of events) {
    if (!event.field || !isReferenceField(event.field)) continue;
    for (const value of [event.fromValue, event.toValue]) {
      if (typeof value === "string" && value) ids[event.field].add(value);
    }
  }

  const select = { id: true, name: true } as const;
  const [locations, categories, assetModels] = await Promise.all([
    ids.locationId.size > 0
      ? db.location.findMany({
          where: { id: { in: [...ids.locationId] }, organizationId },
          select,
        })
      : [],
    ids.categoryId.size > 0
      ? db.category.findMany({
          where: { id: { in: [...ids.categoryId] }, organizationId },
          select,
        })
      : [],
    ids.assetModelId.size > 0
      ? db.assetModel.findMany({
          where: { id: { in: [...ids.assetModelId] }, organizationId },
          select,
        })
      : [],
  ]);

  const byId = (rows: { id: string; name: string }[]) =>
    new Map(rows.map((row) => [row.id, row.name]));
  return {
    locationId: byId(locations),
    categoryId: byId(categories),
    assetModelId: byId(assetModels),
  };
}

/** One side of a change as text, or `null` when that side is empty. */
function readableValue(
  field: string,
  value: unknown,
  names: ReferenceNames
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (isReferenceField(field) && typeof value === "string") {
    return names[field].get(value) ?? `(deleted ${REFERENCE_FIELDS[field]})`;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}

/**
 * Describes one event in plain words, with ids replaced by names.
 *
 * @param label - The action's label, e.g. "Location changed"
 * @param event - The event to describe
 * @param names - Names from {@link loadReferenceNames} for the same page
 * @returns The sentence plus the readable before and after values
 */
export function describeChange(
  label: string,
  event: DescribableEvent,
  names: ReferenceNames
): ActivityDescription {
  if (!event.field) {
    return { description: label, changedFrom: null, changedTo: null };
  }

  const changedFrom = readableValue(event.field, event.fromValue, names);
  const changedTo = readableValue(event.field, event.toValue, names);
  const attribute = CHANGED_ATTRIBUTE[event.action];

  let description = label;
  if (changedFrom && changedTo) {
    description = `${label}: ${changedFrom} → ${changedTo}`;
  } else if (attribute && changedTo) {
    description = `${attribute} set to ${changedTo}`;
  } else if (attribute && changedFrom) {
    description = `${attribute} removed, was ${changedFrom}`;
  }

  return { description, changedFrom, changedTo };
}
