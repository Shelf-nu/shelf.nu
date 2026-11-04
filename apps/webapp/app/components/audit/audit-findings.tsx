/**
 * Audit findings
 *
 * The Findings column on the audit overview: the condition notes and photos
 * people recorded while auditing, grouped by asset, with notes and photos
 * about the audit as a whole first. The list reveals asset rows ten at a time
 * as it is scrolled, and an "Expand" button opens the same findings in a
 * side sheet with larger photos.
 *
 * The page loader sends every finding; what is batched is rendering, so a
 * long audit does not mount hundreds of rows and fetch every thumbnail up
 * front.
 *
 * @see {@link file://./audit-findings-helpers.ts} Grouping and batch maths
 * @see {@link file://./../../routes/_layout+/audits.$auditId.overview.tsx} The page
 */
import { useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
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
import { tw } from "~/utils/tw";
import type { UserNameFields } from "~/utils/user";
import { resolveUserDisplayName } from "~/utils/user";
import type { AuditFinding } from "./audit-findings-helpers";
import {
  FINDINGS_BATCH_SIZE,
  findingSummary,
  groupAuditFindings,
  nextVisibleCount,
} from "./audit-findings-helpers";

/** The asset a photo or note was recorded against; null for the audit itself. */
type RecordedAgainst = {
  auditAsset?: { asset?: { id: string; title: string | null } | null } | null;
};

/** A photo taken during the audit. */
export type FindingImage = RecordedAgainst & {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  description: string | null;
};

/** A condition note written during the audit. */
export type FindingNote = RecordedAgainst & {
  id: string;
  content: string;
  createdAt: string | Date;
  user: UserNameFields | null;
};

/** `compact` sits in the overview card; `expanded` fills the side sheet. */
type FindingsVariant = "compact" | "expanded";

/** Everything one Findings list renders. */
type FindingsContent = {
  findings: AuditFinding<FindingImage, FindingNote>[];
  generalNotes: FindingNote[];
  generalImages: FindingImage[];
};

/**
 * The Findings heading, card and expanded sheet.
 *
 * Lays itself out to fill the height its parent gives it on large screens:
 * the card is absolutely positioned so its content never adds to the row
 * height, and the list scrolls inside it. Below `lg` the card caps itself
 * with a max height instead.
 *
 * @param props.images - Every photo taken during the audit
 * @param props.notes - Every condition note written during the audit
 */
export function AuditFindings({
  images,
  notes,
}: {
  images: FindingImage[];
  notes: FindingNote[];
}) {
  const content: FindingsContent = {
    findings: groupAuditFindings({ images, notes }),
    generalNotes: notes.filter((note) => !note.auditAsset?.asset?.id),
    generalImages: images.filter((image) => !image.auditAsset?.asset?.id),
  };
  const { findings, generalNotes, generalImages } = content;
  const hasFindings =
    findings.length > 0 || generalNotes.length > 0 || generalImages.length > 0;

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
          {findings.length > 0 && (
            <span className="ml-1 text-sm font-normal text-gray-500">
              {assetCountLabel(findings.length)}
            </span>
          )}
        </h2>
        {hasFindings && <ExpandedFindingsSheet content={content} />}
      </div>

      <div className="relative min-h-[120px] flex-1">
        <div className="flex max-h-[480px] flex-col overflow-hidden rounded border bg-white lg:absolute lg:inset-0 lg:max-h-none">
          {hasFindings ? (
            <FindingsList content={content} variant="compact" />
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
 * The "Expand" button and the right-hand sheet it opens, listing the same
 * findings with larger photos for reading through a whole audit.
 *
 * The list mounts when the sheet opens, so it starts again from the first
 * batch each time.
 */
function ExpandedFindingsSheet({ content }: { content: FindingsContent }) {
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
            {content.findings.length > 0
              ? `${assetCountLabel(
                  content.findings.length
                )} with notes or photos from this audit`
              : "Notes and photos about this audit"}
          </SheetDescription>
        </SheetHeader>
        <FindingsList content={content} variant="expanded" />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The scrolling list of findings: the audit-wide block, then one row per
 * asset, revealed a batch at a time.
 */
function FindingsList({
  content,
  variant,
}: {
  content: FindingsContent;
  variant: FindingsVariant;
}) {
  const { findings, generalNotes, generalImages } = content;
  const { visibleCount, showMore, setScrollRoot, setSentinel } =
    useRevealInBatches(findings.length, FINDINGS_BATCH_SIZE);
  const remaining = findings.length - visibleCount;
  const expanded = variant === "expanded";

  return (
    <div
      ref={setScrollRoot}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {(generalNotes.length > 0 || generalImages.length > 0) && (
        <section
          className={tw(
            "flex flex-col gap-3 border-b border-gray-200 py-3",
            expanded ? "px-6" : "px-4"
          )}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            About this audit
          </h3>
          {generalNotes.map((note) => (
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
            images={generalImages}
            altFor={(image) => image.description || "General audit image"}
            variant={variant}
          />
        </section>
      )}

      {findings.slice(0, visibleCount).map((finding) => (
        <FindingRow key={finding.assetId} finding={finding} variant={variant} />
      ))}

      {/* Scrolling this into view reveals the next batch. It is also a real
          button, so keyboard and screen reader users are never stuck behind
          an observer. */}
      {remaining > 0 && (
        <div
          ref={setSentinel}
          className="flex justify-center border-t border-gray-100 px-4 py-3"
        >
          <Button type="button" variant="link" size="xs" onClick={showMore}>
            Show {Math.min(remaining, FINDINGS_BATCH_SIZE)} more of {remaining}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One asset's notes and photos. */
function FindingRow({
  finding,
  variant,
}: {
  finding: AuditFinding<FindingImage, FindingNote>;
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
        altFor={() => `Photo of ${assetName}`}
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

/**
 * Reveals a long list a batch at a time as a sentinel element scrolls into
 * view inside its scroll container.
 *
 * The observer is rebuilt after every batch, and a new observer reports the
 * sentinel's current state straight away, so a container tall enough to show
 * the sentinel keeps filling until it either overflows or runs out of rows.
 *
 * @param total - Rows in the list
 * @param batchSize - Rows revealed per batch
 * @returns The count to render, a manual `showMore`, and callback refs for
 *   the scroll container and the sentinel
 */
function useRevealInBatches(total: number, batchSize: number) {
  const [requestedCount, setRequestedCount] = useState(batchSize);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  // Clamped at render so a shorter list after revalidation never overshoots.
  const visibleCount = Math.min(requestedCount, total);

  const showMore = () =>
    setRequestedCount((count) => nextVisibleCount(count, total, batchSize));

  useEffect(() => {
    if (!sentinel || !scrollRoot || visibleCount >= total) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRequestedCount((count) =>
            nextVisibleCount(count, total, batchSize)
          );
        }
      },
      // Start the next batch a little before the sentinel is reached.
      { root: scrollRoot, rootMargin: "0px 0px 200px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, scrollRoot, visibleCount, total, batchSize]);

  return { visibleCount, showMore, setScrollRoot, setSentinel };
}
