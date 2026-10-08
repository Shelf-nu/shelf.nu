/**
 * Move-location-images route: the blob has to leave the database.
 *
 * The migration's whole purpose is to get image bytes out of Postgres and into
 * Supabase Storage. `Location.imageId` is the only reference to an Image row, so
 * clearing the link without deleting the row leaves the blob behind with nothing
 * pointing at it, and no other code path collects it. Moving an image then costs
 * storage in both places at once.
 *
 * @see {@link file://./../../../../app/routes/_layout+/admin-dashboard+/move-location-images.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { action } from "~/routes/_layout+/admin-dashboard+/move-location-images";
import { cropImage } from "~/utils/crop-image";

// why: the migration reads every location that still has a blob and writes the
// rows this suite is about, so the database is the boundary under test.
vi.mock("~/database/db.server", () => ({
  db: { location: { findMany: vi.fn(), update: vi.fn() } },
}));
// why: uploading to real object storage is not what these tests measure.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(),
}));
// why: cropImage runs sharp over the bytes; the thumbnail's content is
// irrelevant to where the original blob ends up.
vi.mock("~/utils/crop-image", () => ({ cropImage: vi.fn() }));
vi.mock("~/utils/roles.server", () => ({ requireAdmin: vi.fn() }));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** A blob the format validator accepts: JPEG magic bytes, plausible size. */
function jpegBlob() {
  const blob = new Uint8Array(2000);
  blob[0] = 0xff;
  blob[1] = 0xd8;
  blob[2] = 0xff;
  return blob;
}

function locationRow(id: string) {
  return {
    id,
    organizationId: "org-1",
    image: {
      id: `image-${id}`,
      blob: jpegBlob(),
      contentType: "image/jpeg",
    },
  };
}

function buildArgs(count = 2) {
  const body = new URLSearchParams({ count: String(count) });
  const request = new Request(
    "http://localhost/admin-dashboard/move-location-images",
    {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  return {
    request,
    params: {},
    context: { getSession: () => ({ userId: "admin-1" }) },
  } as unknown as Parameters<typeof action>[0];
}

/** Every `location.update` call that asked for the Image row to be deleted. */
function imageDeletesFor() {
  return vi
    .mocked(db.location.update)
    .mock.calls.map(([args]) => args as { where: { id: string }; data: any })
    .filter((args) => args.data?.image?.delete === true)
    .map((args) => args.where.id);
}

describe("move-location-images action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The route narrates its progress to stdout; keep the suite readable.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(cropImage).mockResolvedValue(new Uint8Array(200) as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      storage: {
        from: () => ({
          upload: (path: string) =>
            Promise.resolve({ data: { path }, error: null }),
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.test/${path}` },
          }),
        }),
      },
    } as unknown as ReturnType<typeof getSupabaseAdmin>);
    vi.mocked(db.location.findMany).mockResolvedValue([
      locationRow("loc-1"),
      locationRow("loc-2"),
    ] as never);
    vi.mocked(db.location.update).mockResolvedValue({} as never);
  });

  it("deletes the Image row of every location it moves", async () => {
    const result = (await action(buildArgs())) as { moved: number };

    expect(result.moved).toBe(2);
    expect(imageDeletesFor()).toEqual(["loc-1", "loc-2"]);
  });

  it("never settles for disconnecting the image", async () => {
    await action(buildArgs());

    const disconnects = vi
      .mocked(db.location.update)
      .mock.calls.map(([args]) => args as { data: any })
      .filter((args) => args.data?.image?.disconnect);

    expect(disconnects).toEqual([]);
  });

  it("stores the new urls before the row is deleted", async () => {
    await action(buildArgs());

    const urlWrite = vi
      .mocked(db.location.update)
      .mock.calls.map(([args]) => args as { where: { id: string }; data: any })
      .find((args) => args.where.id === "loc-1" && args.data?.imageUrl);

    expect(urlWrite?.data).toMatchObject({
      imageUrl: expect.stringContaining("https://cdn.test/"),
      thumbnailUrl: expect.stringContaining("-thumbnail.jpeg"),
    });
  });

  it("reports a blob it could not delete without dropping the rest of the batch", async () => {
    vi.mocked(db.location.update).mockImplementation((args: any) => {
      if (args.where.id === "loc-1" && args.data?.image?.delete) {
        return Promise.reject(new Error("still referenced")) as never;
      }
      return Promise.resolve({}) as never;
    });

    const result = (await action(buildArgs())) as {
      moved: number;
      errors: string[];
    };

    // The location moved: its urls are written and its files are uploaded. Only
    // the blob cleanup failed, and only for that one row.
    expect(result.moved).toBe(2);
    expect(imageDeletesFor()).toEqual(["loc-1", "loc-2"]);
    expect(result.errors).toEqual([
      expect.stringContaining("Image blob left behind for loc-1"),
    ]);
  });

  it("leaves the image alone when the upload fails", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      storage: {
        from: () => ({
          upload: () =>
            Promise.resolve({ data: null, error: { message: "bucket full" } }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
        }),
      },
    } as unknown as ReturnType<typeof getSupabaseAdmin>);

    const result = (await action(buildArgs())) as {
      moved: number;
      skipped: number;
    };

    expect(result.moved).toBe(0);
    expect(result.skipped).toBe(2);
    expect(imageDeletesFor()).toEqual([]);
  });
});
