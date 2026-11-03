/**
 * Tests for the audit photos embedded in a note, fed the payload
 * `/api/audit-images` sends.
 *
 * @see {@link file://./audit-images-component.tsx}
 * @see {@link file://../../../test/routes-tests/api+/audit-images.test.ts} the
 *   route side of the same payload
 */
import { render } from "@testing-library/react";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";
import { AuditImagesComponent } from "./audit-images-component";

/**
 * The payload `/api/audit-images` serialises, as the component receives it.
 *
 * `useApiQuery` casts the response to the component's type without validating
 * it, so a route that stops sending a field hands the component `undefined`
 * and the compiler stays silent. This fixture is the contract between the two:
 * change the select in `app/routes/api+/audit-images.tsx` and change it here.
 */
const apiAuditImagesPayload = {
  images: [
    {
      id: "img-1",
      imageUrl: "https://storage.test/img-1.webp",
      thumbnailUrl: "https://storage.test/img-1-thumbnail.webp",
      description: null,
      capturedAt: "2026-10-01T06:30:00.000Z",
      captureSource: "LIBRARY",
      createdAt: "2026-10-21T09:17:00.000Z",
      auditSession: { startedAt: "2026-08-13T13:37:00.000Z" },
      auditAsset: { scannedAt: "2026-10-21T09:10:00.000Z" },
    },
    {
      id: "img-2",
      imageUrl: "https://storage.test/img-2.webp",
      thumbnailUrl: "https://storage.test/img-2-thumbnail.webp",
      description: null,
      capturedAt: "2026-10-21T09:15:00.000Z",
      captureSource: "WEB_UPLOAD",
      createdAt: "2026-10-21T09:17:00.000Z",
      auditSession: { startedAt: "2026-10-21T09:00:00.000Z" },
      auditAsset: null,
    },
  ],
};

const { useApiQueryMock } = vi.hoisted(() => ({ useApiQueryMock: vi.fn() }));

// why: the hook fetches in an effect; stubbing it keeps these tests on how the
// component renders a known payload rather than on network behaviour.
vi.mock("~/hooks/use-api-query", () => ({ default: useApiQueryMock }));

// why: `DateS` reads the acting user's format prefs through this hook, which
// reaches the root route loader, and there is no router in a unit test. Same
// stub shape as `audit-photo.test.tsx`.
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

describe("AuditImagesComponent", () => {
  it("captions each photo from the route's payload, flagging only the old one", () => {
    useApiQueryMock.mockReturnValue({
      data: apiAuditImagesPayload,
      isLoading: false,
      error: null,
    });

    const { container } = render(
      <AuditImagesComponent count={2} ids="img-1,img-2" disablePortal />
    );

    const captions = [...container.querySelectorAll("figcaption")];
    expect(captions).toHaveLength(2);
    // The first is checked against its asset's scan, not the August start.
    expect(captions[0].title).toBe(
      "Photo library · file says 01/10/2026, 6:30 AM · 20 days before this asset was scanned"
    );
    expect(captions[0].textContent).toContain("Old photo");
    // The second is a photo of the whole audit, checked against its start.
    expect(captions[1].textContent).not.toMatch(/Old photo|No date/);
  });
});
