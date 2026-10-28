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
};
const unknown = { ...known, id: "img-2", capturedAt: null };

const AUDIT_STARTED = "2026-10-21T08:00:00.000Z";

/** The visible caption under a tile (the sr-only sentence left out). */
function visibleCaption(container: HTMLElement) {
  const caption = container.querySelector("figcaption")!;
  return [...caption.children]
    .filter((child) => !child.classList.contains("sr-only"))
    .map((child) => child.textContent)
    .join(" | ");
}

describe("AuditPhoto", () => {
  it("keeps a photo taken during the audit quiet: icon and time, no flag", () => {
    const { container } = render(
      <AuditPhoto
        image={{
          ...known,
          captureSource: "CAMERA",
          createdAt: "2026-10-21T09:17:00.000Z",
        }}
        auditStartedAt={AUDIT_STARTED}
        alt="Photo of Camera"
        disablePortal
      />
    );

    expect(visibleCaption(container)).toMatch(/^9:15/);
    expect(
      container.querySelector('[aria-label="Shelf app camera"]')
    ).not.toBeNull();
    expect(container.textContent).not.toMatch(/Older than audit|No date/);
  });

  it("flags a photo taken before the audit started", () => {
    // why: an old picture passed off as today's evidence is the case audit
    // photos exist to catch, so it is the one thing on the tile in colour.
    const { container } = render(
      <AuditPhoto
        image={{
          ...known,
          captureSource: "LIBRARY",
          capturedAt: "2026-06-15T14:20:00.000Z",
          createdAt: "2026-10-21T09:17:00.000Z",
        }}
        auditStartedAt={AUDIT_STARTED}
        alt="Photo of Camera"
        disablePortal
      />
    );

    expect(visibleCaption(container)).toBe("15/06/2026 | Older than audit");
    expect(container.querySelector("figcaption")?.title).toBe(
      "Photo library · file says 15/06/2026, 2:20 PM · 127 days before this audit started"
    );
  });

  it("flags a photo with no date instead of leaving it blank", () => {
    const { container } = render(
      <AuditPhoto image={unknown} alt="Photo of Camera" disablePortal />
    );

    expect(visibleCaption(container)).toBe("No date");
  });

  it("shows the full sentence and flag for the photo open in the preview", () => {
    render(
      <AuditPhoto
        image={unknown}
        images={[known, unknown]}
        alt="Photo of Camera"
        disablePortal
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open preview for Photo of Camera" })
    );

    const subtitle = screen.getByText(/2 of 2 image\(s\)/).parentElement!;
    expect(subtitle.textContent).toContain("Time taken unknown");
    expect(subtitle.textContent).toContain("No date");
  });
});
