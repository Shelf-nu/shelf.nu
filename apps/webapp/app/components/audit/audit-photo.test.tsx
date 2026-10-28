/**
 * Tests for the audit photo tile: every audit photo states when it was taken,
 * or that the time is unknown, under the thumbnail and in the preview.
 *
 * @see {@link file://./audit-photo.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";
import { AuditPhoto } from "./audit-photo";

// why: `DateS` reads the acting user's format prefs through this hook, which
// reaches the root route loader, and there is no router in a unit test. Same
// stub shape as `audit-receipt-pdf.test.tsx`.
vi.mock("~/hooks/use-date-formatter", async () => {
  const actual = (await vi.importActual("~/utils/date-format")) as {
    formatDate: (
      value: string | Date,
      prefs: ResolvedFormatPrefs,
      opts?: DateFormatOptions
    ) => string;
  };
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H12",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  return {
    useDateFormatter: () => ({
      prefs,
      formatDate: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, opts),
      formatTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, onlyTime: true }),
      formatDateTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, includeTime: true }),
    }),
  };
});

const known = {
  id: "img-1",
  imageUrl: "https://storage.test/img-1.webp",
  thumbnailUrl: "https://storage.test/img-1-thumbnail.webp",
  capturedAt: "2026-10-21T09:15:00.000Z",
  createdAt: "2026-10-21T09:17:00.000Z",
};
/** A photo from before capture times were read: no source, no date. */
const legacy = {
  ...known,
  id: "img-2",
  capturedAt: null,
  createdAt: "2026-08-19T16:27:00.000Z",
};
/** A new library photo whose file carried no date. */
const undated = {
  ...known,
  id: "img-3",
  captureSource: "LIBRARY" as const,
  capturedAt: null,
};

const AUDIT_STARTED = "2026-08-13T13:37:00.000Z";
const ASSET_SCANNED = "2026-10-21T09:10:00.000Z";

/** The visible caption under a tile (the sr-only sentence left out). */
function visibleCaption(container: HTMLElement) {
  const caption = container.querySelector("figcaption")!;
  return [...caption.children]
    .filter((child) => !child.classList.contains("sr-only"))
    .map((child) => child.textContent)
    .join(" | ");
}

describe("AuditPhoto", () => {
  it("keeps a photo taken at the scan quiet: icon, date and time, no flag", () => {
    const { container } = render(
      <AuditPhoto
        image={{ ...known, captureSource: "CAMERA" }}
        assetScannedAt={ASSET_SCANNED}
        auditStartedAt={AUDIT_STARTED}
        alt="Photo of Camera"
        disablePortal
      />
    );

    // The date is always there, so the tile still makes sense a week later.
    expect(visibleCaption(container)).toBe("21 Oct, 9:15 AM");
    expect(
      container.querySelector('[aria-label="Shelf app camera"]')
    ).not.toBeNull();
    expect(container.textContent).not.toMatch(/Old photo|No date/);
  });

  it("flags a photo taken well before its asset was scanned", () => {
    // why: an old picture passed off as evidence of this check is the case
    // audit photos exist to catch, so it is the one thing on the tile in
    // colour. The audit started in August; the scan time is what decides.
    const { container } = render(
      <AuditPhoto
        image={{
          ...known,
          captureSource: "LIBRARY",
          capturedAt: "2026-10-01T06:30:00.000Z",
        }}
        assetScannedAt={ASSET_SCANNED}
        auditStartedAt={AUDIT_STARTED}
        alt="Photo of Camera"
        disablePortal
      />
    );

    expect(visibleCaption(container)).toBe("1 Oct, 6:30 AM | Old photo");
    expect(container.querySelector("figcaption")?.title).toBe(
      "Photo library · file says 01/10/2026, 6:30 AM · 20 days before this asset was scanned"
    );
  });

  it("prefers the scan time the photo carries over the list's", () => {
    const { container } = render(
      <AuditPhoto
        image={{
          ...known,
          captureSource: "LIBRARY",
          capturedAt: "2026-10-01T06:30:00.000Z",
          auditAsset: { scannedAt: "2026-10-01T07:00:00.000Z" },
        }}
        assetScannedAt={ASSET_SCANNED}
        alt="Photo of Camera"
        disablePortal
      />
    );

    expect(container.textContent).not.toMatch(/Old photo/);
  });

  it("flags a new photo with no date instead of leaving it blank", () => {
    const { container } = render(
      <AuditPhoto image={undated} alt="Photo of Camera" disablePortal />
    );

    expect(visibleCaption(container)).toBe("No date");
  });

  it("shows a photo from before capture times by its upload time, unflagged", () => {
    // why: its date was never looked for; flagging it would mark every photo
    // in every audit taken before this release.
    const { container } = render(
      <AuditPhoto image={legacy} alt="Photo of Camera" disablePortal />
    );

    expect(visibleCaption(container)).toBe("19 Aug, 4:27 PM");
    expect(container.querySelector("figcaption")?.title).toBe(
      "Uploaded 19/08/2026, 4:27 PM"
    );
  });

  it("shows the full sentence and flag for the photo open in the preview", () => {
    render(
      <AuditPhoto
        image={undated}
        images={[known, undated]}
        alt="Photo of Camera"
        disablePortal
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open preview for Photo of Camera" })
    );

    const subtitle = screen.getByText(/2 of 2 image\(s\)/).parentElement!;
    expect(subtitle.textContent).toContain(
      "Photo library · time taken unknown"
    );
    expect(subtitle.textContent).toContain("No date");
  });
});
