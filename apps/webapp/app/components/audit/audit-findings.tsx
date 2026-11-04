/**
 * Audit findings
 *
 * The Findings column on the audit overview: the condition notes and photos
 * people recorded while auditing, grouped by asset, with notes and photos
 * about the audit as a whole first.
 *
 * Asset findings are paged on the server, ten assets per page. The overview
 * loader sends the first page; scrolling to the end of the list requests the
 * page after the last row it holds from `/api/audits/:auditId/findings`. An "Expand" button opens the
 * same list in a side sheet with larger photos. The card and the sheet share
 * one paging state, so pages loaded in one are already there in the other.
 *
 * @see {@link file://./audit-findings-helpers.ts} The paging reducer
 * @see {@link file://./../../modules/audit/findings.server.ts} The page read
 * @see {@link file://./../../routes/api+/audits.$auditId.findings.ts} Next pages
 */
import { useCallback, useEffect, useId, useReducer, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useFetcher } from "react-router";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/shared/sheet";
import { Spinner } from "~/components/shared/spinner";
import type {
  AssetFinding,
  AuditFindingsPage,
  AuditWideFindings,
  FindingImage,
  FindingNote,
} from "~/modules/audit/findings.server";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import type { FindingsListState } from "./audit-findings-helpers";
import {
  findingSummary,
  findingsListReducer,
  initFindingsList,
} from "./audit-findings-helpers";

/** What the findings endpoint answers: a page, or an error. */
type FindingsPageResponse =
  | (AuditFindingsPage & { error: null })
  | { error: { message: string } };

/** `compact` sits in the overview card; `expanded` fills the side sheet. */
type FindingsVariant = "compact" | "expanded";

/** The paging state and controls both lists render from. */
type FindingsPaging = {
  state: FindingsListState;
  isLoading: boolean;
  /** The last request failed; loading resumes only on an explicit retry. */
  failed: boolean;
  loadMore: () => void;
};

/**
 * The Findings heading, card and expanded sheet.
 *
 * Lays itself out to fill the height its parent gives it on large screens:
 * the card is absolutely positioned so its content never adds to the row
 * height, and the list scrolls inside it. Below `lg` the card caps itself
 * with a max height instead.
 *
 * @param props.auditId - The audit whose findings these are
 * @param props.firstPage - The first page of asset findings, from the loader
 * @param props.auditWide - Notes and photos about the audit as a whole
 */
export function AuditFindings({
  auditId,
  firstPage,
  auditWide,
}: {
  auditId: string;
  firstPage: AuditFindingsPage;
  auditWide: AuditWideFindings;
}) {
  const paging = useFindingsPaging(auditId, firstPage);
  const { totalFindings } = paging.state;
  const hasFindings =
    totalFindings > 0 ||
    auditWide.notes.length > 0 ||
    auditWide.images.length > 0;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="flex items-center gap-1 text-lg font-semibold">
          Findings
          <InfoTooltip
            iconClassName="size-4"
            content={
              <p className="mb-3 text-sm text-gray-600">
                The condition notes and photos people recorded while auditing,
                grouped by the asset they were recorded against. Notes about the
                audit itself, such as a completion note, appear first. System
                activity lives on the Activity tab.
              </p>
            }
          />
          {totalFindings > 0 && (
            <span className="ml-1 text-sm font-normal text-gray-500">
              {assetCountLabel(totalFindings)}
            </span>
          )}
        </h2>
        {hasFindings && (
          <ExpandedFindingsSheet paging={paging} auditWide={auditWide} />
        )}
      </div>

      <div className="relative min-h-[120px] flex-1">
        <div className="flex max-h-[480px] flex-col overflow-hidden rounded border bg-white lg:absolute lg:inset-0 lg:max-h-none">
          {hasFindings ? (
            <FindingsList
              paging={paging}
              auditWide={auditWide}
              variant="compact"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 py-6 text-center text-sm text-gray-500">
              Nothing was recorded during this audit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Holds the loaded pages and requests the next one.
 *
 * The fetcher key is unique to this mount, so a remount (the page loader
 * revalidated and sent a new first page) never reads a response that belongs
 * to the list it replaced.
 */
function useFindingsPaging(
  auditId: string,
  firstPage: AuditFindingsPage
): FindingsPaging {
  const [state, dispatch] = useReducer(
    findingsListReducer,
    firstPage,
    initFindingsList
  );
  const fetcher = useFetcher<FindingsPageResponse>({
    key: `audit-findings-${useId()}`,
  });
  const response = fetcher.data;
  const isLoading = fetcher.state !== "idle";
  const failed = !isLoading && response?.error != null;

  // The reducer only takes a page that answers its current cursor, so
  // running this again for a response it already has is harmless.
  useEffect(() => {
    if (response && response.error == null) {
      dispatch({ type: "page_loaded", page: response });
    }
  }, [response]);

  const { nextCursor } = state;
  const { load } = fetcher;
  const loadMore = useCallback(() => {
    if (isLoading || !nextCursor) return;
    const search = new URLSearchParams({
      afterTitle: nextCursor.title,
      afterId: nextCursor.id,
    });
    void load(`/api/audits/${auditId}/findings?${search.toString()}`);
  }, [auditId, isLoading, nextCursor, load]);

  return { state, isLoading, failed, loadMore };
}

/**
 * The "Expand" button and the right-hand sheet it opens, listing the same
 * findings with larger photos for reading through a whole audit.
 */
function ExpandedFindingsSheet({
  paging,
  auditWide,
}: {
  paging: FindingsPaging;
  auditWide: AuditWideFindings;
}) {
  const { totalFindings } = paging.state;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="ml-auto"
          aria-label="Expand findings"
        >
          <span className="flex items-center gap-1.5">
            <Maximize2 className="size-3.5" aria-hidden />
            Expand
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 bg-white p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-6 py-4 pr-12">
          <SheetTitle>Findings</SheetTitle>
          <SheetDescription className="text-sm text-gray-600">
            {totalFindings > 0
              ? `${assetCountLabel(
                  totalFindings
                )} with notes or photos from this audit`
              : "Notes and photos about this audit"}
          </SheetDescription>
        </SheetHeader>
        <FindingsList
          paging={paging}
          auditWide={auditWide}
          variant="expanded"
        />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The scrolling list of findings: the audit-wide block, then one row per
 * loaded asset, then a footer that loads the next page when it scrolls into
 * view.
 */
function FindingsList({
  paging,
  auditWide,
  variant,
}: {
  paging: FindingsPaging;
  auditWide: AuditWideFindings;
  variant: FindingsVariant;
}) {
  const { state, isLoading, failed, loadMore } = paging;
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const expanded = variant === "expanded";

  return (
    <div
      ref={setScrollRoot}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {(auditWide.notes.length > 0 || auditWide.images.length > 0) && (
        <section
          className={tw(
            "flex flex-col gap-3 border-b border-gray-200 py-3",
            expanded ? "px-6" : "px-4"
          )}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            About this audit
          </h3>
          {auditWide.notes.map((note) => (
            <div key={note.id}>
              {/* Audit notes are Markdoc source, not plain text: the
                  completion note carries `**bold**` stats, a receipt link and
                  an `{% audit_images %}` tag. `allowExternalLinks` stays false
                  because this bucket holds the SYSTEM-composed completion
                  note; only notes a person authored through the editor may
                  link off-origin. */}
              <div className="text-sm text-gray-900">
                <MarkdownViewer content={note.content} />
              </div>
              <NoteByline note={note} />
            </div>
          ))}
          <PhotoStrip
            images={auditWide.images}
            altFor={(image) => image.description || "General audit image"}
            variant={variant}
          />
        </section>
      )}

      {state.findings.map((finding) => (
        <FindingRow key={finding.assetId} finding={finding} variant={variant} />
      ))}

      {state.hasMore && (
        <NextPageFooter
          scrollRoot={scrollRoot}
          isLoading={isLoading}
          failed={failed}
          remaining={state.totalFindings - state.findings.length}
          onLoadMore={loadMore}
        />
      )}
    </div>
  );
}

/**
 * The end of a list with more pages: requests the next page when it scrolls
 * into view, shows a spinner while it loads, and offers a retry after a
 * failed request. It is a real button too, so keyboard and screen reader
 * users can load more without scrolling.
 *
 * A failed request does not retry on scroll, so a broken endpoint is not
 * hammered while the footer sits in view.
 */
function NextPageFooter({
  scrollRoot,
  isLoading,
  failed,
  remaining,
  onLoadMore,
}: {
  scrollRoot: HTMLElement | null;
  isLoading: boolean;
  failed: boolean;
  remaining: number;
  onLoadMore: () => void;
}) {
  const [footer, setFooter] = useState<HTMLElement | null>(null);

  // A new observer reports the footer's current state straight away, and the
  // effect re-runs when a load finishes, so a list too short to scroll keeps
  // loading until it fills the container or runs out of pages.
  useEffect(() => {
    if (!footer || !scrollRoot || isLoading || failed) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      // Start the request a little before the footer is reached.
      { root: scrollRoot, rootMargin: "0px 0px 200px 0px" }
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, [footer, scrollRoot, isLoading, failed, onLoadMore]);

  return (
    <div
      ref={setFooter}
      className="flex items-center justify-center gap-2 border-t border-gray-100 px-4 py-3 text-sm"
    >
      {isLoading ? (
        <>
          <Spinner className="size-4" />
          <span className="text-gray-500">Loading more findings</span>
        </>
      ) : failed ? (
        <>
          <span role="alert" className="text-error-600">
            Could not load more findings.
          </span>
          <Button type="button" variant="link" size="xs" onClick={onLoadMore}>
            Try again
          </Button>
        </>
      ) : (
        <Button type="button" variant="link" size="xs" onClick={onLoadMore}>
          Load more ({remaining} left)
        </Button>
      )}
    </div>
  );
}

/** One asset's notes and photos. */
function FindingRow({
  finding,
  variant,
}: {
  finding: AssetFinding;
  variant: FindingsVariant;
}) {
  const { assetName, images, notes } = finding;
  const expanded = variant === "expanded";

  return (
    <div
      className={tw(
        "flex flex-col border-b border-gray-100 last:border-b-0",
        expanded ? "gap-3 px-6 py-4" : "gap-2 px-4 py-3"
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className={tw(
            "min-w-0 font-medium text-gray-900",
            expanded ? "text-base" : "truncate text-sm"
          )}
        >
          {assetName}
        </h3>
        <span className="shrink-0 text-xs text-gray-500">
          {findingSummary(images.length, notes.length)}
        </span>
      </div>

      {notes.map((note) => (
        <div
          key={note.id}
          className={tw(
            "rounded bg-gray-50",
            expanded ? "px-3 py-2" : "px-2.5 py-1.5"
          )}
        >
          {/* Condition notes are authored through the editor, so they may
              link out, same as the details panel renders these rows. */}
          <div className="text-sm text-gray-900">
            <MarkdownViewer content={note.content} allowExternalLinks />
          </div>
          <NoteByline note={note} />
        </div>
      ))}

      <PhotoStrip
        images={images}
        altFor={(image) => image.description || `Photo of ${assetName}`}
        variant={variant}
      />
    </div>
  );
}

/** Who wrote a note, and when. */
function NoteByline({ note }: { note: FindingNote }) {
  return (
    <p className="mt-0.5 text-xs text-gray-500">
      {resolveUserDisplayName(note.user) || "Unknown"} &middot;{" "}
      <DateS date={note.createdAt} includeTime />
    </p>
  );
}

/** A row of thumbnails that open a navigable preview of the whole set. */
function PhotoStrip({
  images,
  altFor,
  variant,
}: {
  images: FindingImage[];
  altFor: (image: FindingImage) => string;
  variant: FindingsVariant;
}) {
  if (images.length === 0) return null;

  const gallery = images.map((image) => ({
    id: image.id,
    imageUrl: image.imageUrl,
    thumbnailUrl: image.thumbnailUrl,
    alt: altFor(image),
  }));

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image) => (
        <ImageWithPreview
          key={image.id}
          imageUrl={image.imageUrl}
          thumbnailUrl={image.thumbnailUrl}
          alt={altFor(image)}
          withPreview
          className={tw(
            "rounded border",
            variant === "expanded" ? "size-28" : "size-14"
          )}
          images={gallery}
          currentImageId={image.id}
        />
      ))}
    </div>
  );
}

/** "1 asset" or "N assets". */
function assetCountLabel(count: number) {
  return `${count} ${count === 1 ? "asset" : "assets"}`;
}
