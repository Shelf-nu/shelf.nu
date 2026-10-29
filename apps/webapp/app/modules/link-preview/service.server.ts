/**
 * Link previews
 *
 * Page titles for web links in custom field values, one `LinkPreview` row per
 * workspace and `LinkKey`, so a manual linked from many assets is fetched once
 * and named once.
 *
 * Titles are claimed where they are read, never where values are written:
 * `getLinkTitles` is called by the loaders that render link chips, and it
 * claims links from Link-format fields that were never fetched or are due
 * again, then queues one job per claimed row. Only stored values reach it, so
 * no request can make the server fetch a URL of its choosing. The worker runs
 * `runLinkPreviewJob`, and people name links with `setLinkTitle`. The two
 * write disjoint columns, so a rename racing a fetch loses nothing.
 *
 * Titles are decoration: reading them never throws into a loader.
 *
 * @see {@link file://./policy.ts} how a fetched head is judged and retried
 * @see {@link file://./worker.server.ts} the queue worker
 * @see {@link file://../../routes/api+/link-titles.ts} the rename endpoint
 */

import { CustomFieldType, Prisma } from "@prisma/client";
import { cleanLinkTitle, MAX_LINK_LENGTH, parseLink } from "@shelf/links";
import type { LinkKey, LinkTitle, LinkTitles, ParsedLink } from "@shelf/links";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import type { ErrorLabel } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { fetchPageTitle } from "./fetch-title.server";
import { nextFetchAfter } from "./policy";

const label: ErrorLabel = "Link preview";

/**
 * How long a claim holds a link. A queued fetch that never runs (a lost job,
 * a failed enqueue) is claimed again by the next read after this.
 */
const LEASE = "15 minutes";

/** At most this many links are claimed by one read, so one page view stays cheap. */
const MAX_CLAIMS_PER_READ = 20;

/** The payload of a link preview job. */
export type LinkPreviewJob = {
  /** `LinkPreview.id`; the URL is read from the row, never from the job. */
  previewId: string;
  /** Workspace that owns the row; every read and write is scoped by it. */
  organizationId: string;
};

/**
 * One custom field value as a loader holds it, with what its field says about
 * fetching. Only TEXT values are read for links.
 */
export interface LinkTitleSource {
  /** `AssetCustomFieldValue.value`; a TEXT value keeps its text in `raw`. */
  readonly value: unknown;
  readonly customField: {
    readonly type: CustomFieldType;
    /** Links in a "LINK" field have their page title fetched. */
    readonly format?: "PLAIN" | "LINK";
  };
}

/**
 * Titles for the links among these custom field values, keyed by `LinkKey`.
 *
 * Reads the workspace's rows for every TEXT value that is one link. Links
 * from Link-format fields that were never fetched, or whose next fetch is
 * due, are claimed (at most {@link MAX_CLAIMS_PER_READ}) and queued for the
 * worker, so their titles appear on a later load. Links from plain fields are
 * never claimed. Never throws: a failure is logged and the titles read so far
 * (or none) are returned.
 *
 * @param args.organizationId - Workspace whose rows are read and claimed
 * @param args.values - Custom field values with their field's type and format
 * @returns Titles for links that have a page title or a custom name
 */
export async function getLinkTitles({
  organizationId,
  values,
}: {
  organizationId: string;
  values: readonly LinkTitleSource[];
}): Promise<LinkTitles> {
  const { keys, fetchable } = linkKeysOf(values);
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
  await claimAndQueue(organizationId, due.slice(0, MAX_CLAIMS_PER_READ));

  const titles: Record<string, LinkTitle> = {};
  for (const { url, pageTitle, customTitle } of rows) {
    if (pageTitle !== null || customTitle !== null) {
      titles[url] = { pageTitle, customTitle };
    }
  }
  return titles;
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
 * Worker body: fetches one claimed link and records the outcome, the attempt
 * count and the next fetch time. Never touches `customTitle`. Running it twice
 * converges on the same row, and a row deleted in the meantime is skipped.
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
    select: { url: true, attempts: true },
  });
  if (!row) return;

  const link = parseLink(row.url);
  const result = link
    ? await fetchPageTitle(link)
    : ({ outcome: "UNREACHABLE", permanent: true } as const);
  const attempts = row.attempts + 1;
  const fetchedAt = new Date();

  await db.linkPreview.updateMany({
    where,
    data: {
      outcome: result.outcome,
      pageTitle: result.outcome === "TITLE" ? result.title : null,
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

/** The text of a TEXT value, or null when the value has none. */
function textOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("raw" in value)) {
    return null;
  }
  return typeof value.raw === "string" ? value.raw : null;
}

/**
 * Keys of every TEXT value that is one storable link (`keys`), and the subset
 * that comes from Link-format fields (`fetchable`). Sets, so a link repeated
 * across values is read and claimed once.
 */
function linkKeysOf(values: readonly LinkTitleSource[]) {
  const keys = new Set<LinkKey>();
  const fetchable = new Set<LinkKey>();
  for (const { value, customField } of values) {
    if (customField.type !== CustomFieldType.TEXT) continue;
    const text = textOf(value);
    const link = text === null ? null : parseLink(text);
    if (!link || !isStorable(link.key)) continue;
    keys.add(link.key);
    if (customField.format === "LINK") fetchable.add(link.key);
  }
  return { keys, fetchable };
}

/**
 * Claims links that are absent or due and queues a fetch for each claimed
 * row. Concurrent readers on any machine claim each link once: the conflict
 * `WHERE` is re-checked on the locked row, so a second reader sees the moved
 * lease and skips it. Never throws; a claim whose job was not queued expires
 * with its lease and is claimed again by a later read.
 */
async function claimAndQueue(
  organizationId: string,
  keys: readonly LinkKey[]
): Promise<void> {
  if (keys.length === 0) return;

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
    return;
  }

  await Promise.all(
    claimed.map(async ({ id }) => {
      const job: LinkPreviewJob = { previewId: id, organizationId };
      try {
        // Retries are scheduled through `nextFetchAt`, not by pg-boss: a
        // failed link is tried again only when someone views it again.
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
}
