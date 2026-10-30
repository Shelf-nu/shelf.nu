/**
 * Link previews
 *
 * Page titles for the web links Shelf shows as link chips (custom field
 * values, asset descriptions, comments and the values system notes mark as
 * chips), one `LinkPreview` row per workspace and `LinkKey`, so a manual linked
 * from many places is fetched once and named once.
 *
 * Titles are claimed where they are read, never where text is written:
 * `getLinkTitles` is called by the loaders that render link chips, and it
 * claims the shown links that were never fetched or are due again, then
 * queues one job per claimed row. Anyone who can write a comment or a field
 * value can therefore make the server fetch a public URL they chose, later and
 * at most once per due time. The limits are: only links a page shows as chips
 * are claimed, at most {@link MAX_CLAIMS_PER_TEXT} per text and
 * {@link MAX_CLAIMS_PER_READ} per page view, a claim is leased so concurrent
 * views do not repeat it, and every fetch goes through the SSRF guard
 * (`safeFetchPrefix`: public addresses only, a byte cap and a timeout). The
 * worker runs `runLinkPreviewJob`, and people name links with `setLinkTitle`.
 * The two write disjoint columns, so a rename racing a fetch loses nothing.
 *
 * Titles are decoration: reading them never throws into a loader.
 *
 * @see {@link file://./policy.ts} how a fetched head is judged and retried
 * @see {@link file://./worker.server.ts} the queue worker
 * @see {@link file://../../routes/api+/link-titles.ts} the rename endpoint
 */

import { CustomFieldType, Prisma } from "@prisma/client";
import {
  cleanLinkTitle,
  MAX_LINK_LENGTH,
  parseLink,
  segmentText,
} from "@shelf/links";
import type {
  FieldLinkTitles,
  LinkKey,
  LinkTitle,
  LinkTitles,
  ParsedLink,
} from "@shelf/links";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import type { ErrorLabel } from "~/utils/error";
import { chipUrlsInNote } from "~/utils/link-chips-in-markdoc";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { fetchPageTitle } from "./fetch-title.server";
import { nextFetchAfter } from "./policy";
import type { PageTitleResult } from "./policy";

const label: ErrorLabel = "Link preview";

/**
 * How long a claim holds a link. A queued fetch that never runs (a lost job,
 * a failed enqueue) is claimed again by the next read after this.
 */
const LEASE = "15 minutes";

/** At most this many links are claimed by one read, so one page view stays cheap. */
const MAX_CLAIMS_PER_READ = 20;

/**
 * At most this many links of one text (a comment, a description) are claimed,
 * so a text full of links cannot fill the queue. Its other links still show
 * titles fetched before.
 */
const MAX_CLAIMS_PER_TEXT = 10;

/** The payload of a link preview job. */
export type LinkPreviewJob = {
  /** `LinkPreview.id`; the URL is read from the row, never from the job. */
  previewId: string;
  /** Workspace that owns the row; every read and write is scoped by it. */
  organizationId: string;
};

/**
 * One custom field value as a loader holds it. Only TEXT and OPTION values
 * are read for links.
 */
export interface LinkTitleSource {
  /** `AssetCustomFieldValue.value`; TEXT and OPTION keep their text in `raw`. */
  readonly value: unknown;
  readonly customField: { readonly type: CustomFieldType };
}

/**
 * Titles for the links a page shows as chips, keyed by `LinkKey`.
 *
 * Reads the workspace's rows for every link shown: each TEXT custom field
 * value that is one link, each web link in a plain text (a description), and
 * each link a note renders as a chip (`chipUrlsInNote`). Links that were never
 * fetched, or whose next fetch is due, are claimed (at most
 * {@link MAX_CLAIMS_PER_TEXT} per text and {@link MAX_CLAIMS_PER_READ} in all)
 * and queued for the worker, so their titles appear on a later load. The
 * claim runs in the background: the titles return without waiting for it.
 * Never throws: a failure is logged and the titles read so far (or none) are
 * returned.
 *
 * @param args.organizationId - Workspace whose rows are read and claimed
 * @param args.values - Custom field values with their field's type
 * @param args.texts - Plain texts shown with chips (asset descriptions)
 * @param args.notes - Activity notes shown, with their type
 * @returns Titles for links that have a page title or a custom name
 */
export async function getLinkTitles({
  organizationId,
  values = [],
  texts = [],
  notes = [],
}: {
  organizationId: string;
  values?: readonly LinkTitleSource[];
  texts?: readonly string[];
  notes?: readonly { type: "COMMENT" | "UPDATE"; content: string }[];
}): Promise<LinkTitles> {
  const keys = linkKeysOf(values);
  const fetchable = new Set(keys);
  const addText = (urls: readonly string[]) => {
    let claimable = MAX_CLAIMS_PER_TEXT;
    for (const url of urls) {
      const link = parseLink(url);
      if (!link || !isStorable(link.key)) continue;
      keys.add(link.key);
      if (claimable > 0 && !fetchable.has(link.key)) {
        fetchable.add(link.key);
        claimable--;
      }
    }
  };
  for (const text of texts) {
    addText(
      segmentText(text).flatMap((segment) =>
        segment.type === "link" ? [segment.url] : []
      )
    );
  }
  for (const note of notes) addText(chipUrlsInNote(note));
  return readTitlesAndClaim(organizationId, keys, fetchable);
}

/**
 * Reads the workspace's rows for `keys` and claims the `fetchable` ones that
 * were never fetched or are due (at most {@link MAX_CLAIMS_PER_READ}), without
 * waiting for the claim. Never throws.
 */
async function readTitlesAndClaim(
  organizationId: string,
  keys: ReadonlySet<LinkKey>,
  fetchable: ReadonlySet<LinkKey>
): Promise<LinkTitles> {
  if (keys.size === 0) return {};

  let rows: {
    url: string;
    pageTitle: string | null;
    customTitle: string | null;
    nextFetchAt: Date | null;
  }[];
  try {
    rows = await db.linkPreview.findMany({
      where: { organizationId, url: { in: [...keys] } },
      select: {
        url: true,
        pageTitle: true,
        customTitle: true,
        nextFetchAt: true,
      },
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to read link titles",
        additionalData: { organizationId },
        label,
      })
    );
    return {};
  }

  const now = new Date();
  const nextFetchAt = new Map(rows.map((row) => [row.url, row.nextFetchAt]));
  const due = [...fetchable].filter((key) => {
    const next = nextFetchAt.get(key);
    // No row yet, or a row whose next fetch time has come.
    return next === undefined || (next !== null && next <= now);
  });
  void claimAndQueue(organizationId, due.slice(0, MAX_CLAIMS_PER_READ));

  const titles: Record<string, LinkTitle> = {};
  for (const { url, pageTitle, customTitle } of rows) {
    if (pageTitle !== null || customTitle !== null) {
      titles[url] = { pageTitle, customTitle };
    }
  }
  return titles;
}

/**
 * The title of the link in each value, keyed by the value's custom field id,
 * for a client that must not compute link keys itself. Values that are not
 * one link, or whose link has no title, are left out.
 *
 * @param values - Custom field values with their field's id and type
 * @param titles - What `getLinkTitles` returned for the same values
 * @returns Titles by custom field id
 */
export function linkTitlesByField(
  values: readonly (LinkTitleSource & {
    readonly customField: { id: string };
  })[],
  titles: LinkTitles
): FieldLinkTitles {
  const byField: Record<string, LinkTitle> = {};
  for (const { value, customField } of values) {
    if (!holdsLinkText(customField.type)) continue;
    const text = textOf(value);
    const link = text === null ? null : parseLink(text);
    const title = link ? titles[link.key] : undefined;
    if (title) byField[customField.id] = title;
  }
  return byField;
}

/**
 * Sets or clears the workspace's name for a link; the only writer of
 * `customTitle`. The name is cleaned like a page title (control and bidi
 * characters removed, whitespace collapsed, at most 120 characters); a blank
 * name clears it. Creates the row when the link was never seen, leaving its
 * fetch schedule to `getLinkTitles`.
 *
 * @param args.organizationId - Workspace that owns the name
 * @param args.link - The link being named
 * @param args.title - The name typed; blank clears it
 * @returns The link's page title and its name after the change
 * @throws {ShelfError} 400 when the link is too long to store, 500 when the
 *   write fails
 */
export async function setLinkTitle({
  organizationId,
  link,
  title,
}: {
  organizationId: string;
  link: ParsedLink;
  title: string;
}): Promise<LinkTitle> {
  if (!isStorable(link.key)) {
    throw new ShelfError({
      cause: null,
      message: "This link is too long to name.",
      additionalData: { organizationId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const customTitle = cleanLinkTitle(title);
  try {
    return await db.linkPreview.upsert({
      where: { organizationId_url: { organizationId, url: link.key } },
      create: { organizationId, url: link.key, customTitle },
      update: { customTitle },
      select: { pageTitle: true, customTitle: true },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while naming this link. Please try again.",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Whether some asset of the workspace stores exactly this text as a custom
 * field value, which is what a link must be before it can be named.
 *
 * @param args.organizationId - Workspace whose assets are searched
 * @param args.value - The value as stored, untrimmed
 * @returns True when at least one stored value equals `value`
 */
export async function isLinkStoredInWorkspace({
  organizationId,
  value,
}: {
  organizationId: string;
  value: string;
}): Promise<boolean> {
  const stored = await db.assetCustomFieldValue.findFirst({
    where: {
      asset: { organizationId },
      value: { path: ["raw"], equals: value },
    },
    select: { id: true },
  });
  return stored !== null;
}

/**
 * Worker body: fetches one claimed link and records the outcome, the attempt
 * count and the next fetch time. Never touches `customTitle`. Running it twice
 * converges on the same row, and a row deleted in the meantime is skipped.
 *
 * `attempts` counts failed fetches in a row since the link last had a title,
 * so a title starts the retry delays over. A transient failure keeps the
 * title the row already has, so a page that is briefly down keeps its name
 * on the chips until it is fetched again. A page that answers "gone" while
 * the row has a title is treated as transient too: a page that had a title
 * is more likely mid-move than deleted, and a final answer would wipe the
 * title for good.
 *
 * @param job - The claimed row's id and workspace
 * @throws When the database read or write fails
 */
export async function runLinkPreviewJob({
  previewId,
  organizationId,
}: LinkPreviewJob): Promise<void> {
  const where = { id: previewId, organizationId };
  const row = await db.linkPreview.findFirst({
    where,
    select: { url: true, attempts: true, pageTitle: true },
  });
  if (!row) return;

  const link = parseLink(row.url);
  const fetched: PageTitleResult = link
    ? await fetchPageTitle(link)
    : { outcome: "UNREACHABLE", permanent: true };
  const goneWithTitle =
    link !== null &&
    row.pageTitle !== null &&
    fetched.outcome === "UNREACHABLE" &&
    fetched.permanent;
  const result: PageTitleResult = goneWithTitle
    ? { outcome: "UNREACHABLE", permanent: false }
    : fetched;
  const transient = "permanent" in result && !result.permanent;
  const attempts = result.outcome === "TITLE" ? 0 : row.attempts + 1;
  const fetchedAt = new Date();

  await db.linkPreview.updateMany({
    where,
    data: {
      outcome: result.outcome,
      ...(transient
        ? {}
        : { pageTitle: result.outcome === "TITLE" ? result.title : null }),
      attempts,
      fetchedAt,
      nextFetchAt: nextFetchAfter(result, attempts, fetchedAt),
    },
  });
}

/** The DB checks `url` against the same cap; a longer key cannot be stored. */
function isStorable(key: LinkKey): boolean {
  return key.length <= MAX_LINK_LENGTH;
}

/**
 * Whether a field's values are free text that can be a link: TEXT, and OPTION,
 * whose options are text an admin typed. The asset page and the index render
 * both as chips, so both are read and claimed for titles.
 */
function holdsLinkText(type: CustomFieldType): boolean {
  return type === CustomFieldType.TEXT || type === CustomFieldType.OPTION;
}

/** The text of a TEXT or OPTION value, or null when the value has none. */
function textOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("raw" in value)) {
    return null;
  }
  return typeof value.raw === "string" ? value.raw : null;
}

/**
 * Keys of every TEXT or OPTION value that is one storable link, as a set so a link
 * repeated across values is read and claimed once.
 */
function linkKeysOf(values: readonly LinkTitleSource[]): Set<LinkKey> {
  const keys = new Set<LinkKey>();
  for (const { value, customField } of values) {
    if (!holdsLinkText(customField.type)) continue;
    const text = textOf(value);
    const link = text === null ? null : parseLink(text);
    if (link && isStorable(link.key)) keys.add(link.key);
  }
  return keys;
}

/**
 * Claims links that are absent or due and queues a fetch for each claimed
 * row. Concurrent readers on any machine claim each link once: the conflict
 * `WHERE` is re-checked on the locked row, so a second reader sees the moved
 * lease and skips it. A row whose `nextFetchAt` is null or still ahead is
 * never claimed. Never throws; a claim whose job was not queued expires with
 * its lease and is claimed again by a later read.
 *
 * Called without waiting by {@link getLinkTitles}; exported for the
 * real-database test of the claim (`service.db.test.ts`).
 *
 * @param organizationId - Workspace that owns the rows
 * @param keys - Distinct link keys to claim
 * @returns The ids of the rows this call claimed (empty when the claim
 *   failed)
 */
export async function claimAndQueue(
  organizationId: string,
  keys: readonly LinkKey[]
): Promise<string[]> {
  if (keys.length === 0) return [];

  let claimed: { id: string }[];
  try {
    // `keys` holds no duplicates: one INSERT cannot touch a row twice.
    claimed = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "LinkPreview" ("id", "organizationId", "url", "nextFetchAt", "updatedAt")
      SELECT gen_random_uuid()::text, ${organizationId}, k.url, now() + ${LEASE}::interval, now()
      FROM unnest(${keys}::text[]) AS k(url)
      ON CONFLICT ("organizationId", "url") DO UPDATE
        SET "nextFetchAt" = EXCLUDED."nextFetchAt", "updatedAt" = now()
        WHERE "LinkPreview"."nextFetchAt" IS NOT NULL
          AND "LinkPreview"."nextFetchAt" <= now()
      RETURNING "id"
    `);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to claim links for a title fetch",
        additionalData: { organizationId, count: keys.length },
        label,
      })
    );
    return [];
  }

  await Promise.all(
    claimed.map(async ({ id }) => {
      const job: LinkPreviewJob = { previewId: id, organizationId };
      try {
        // pg-boss never retries: `nextFetchAt` makes a failed link eligible
        // again, and it is fetched again only when someone views it.
        await scheduler.send(QueueNames.linkPreviewQueue, job, {
          singletonKey: id,
          retryLimit: 0,
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to queue a link title fetch",
            additionalData: { organizationId, previewId: id },
            label,
          })
        );
      }
    })
  );
  return claimed.map(({ id }) => id);
}
