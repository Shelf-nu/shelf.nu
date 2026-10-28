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

describe("AuditPhoto", () => {
  it("states when the photo was taken under its thumbnail", () => {
    const { container } = render(
      <AuditPhoto image={known} alt="Photo of Camera" disablePortal />
    );

    expect(container.querySelector("figcaption")?.textContent).toMatch(
      /^Taken 21\/10\/2026.*9:15/
    );
  });

  it("states that the time is unknown when the photo carried none", () => {
    // why: a photo with no capture time is the one a reviewer needs to see,
    // so the tile says so rather than staying blank.
    const { container } = render(
      <AuditPhoto image={unknown} alt="Photo of Camera" disablePortal />
    );

    expect(container.querySelector("figcaption")?.textContent).toBe(
      "Time taken unknown"
    );
  });

  it("repeats the line for the photo open in the preview", () => {
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

    expect(screen.getByText(/2 of 2 image\(s\)/).textContent).toContain(
      "Time taken unknown"
    );
  });
});
