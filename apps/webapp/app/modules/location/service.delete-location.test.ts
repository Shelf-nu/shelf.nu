import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { Logger } from "~/utils/logger";

// why: exercise the delete flows without a database; only the delegates the
// two delete functions touch are stubbed
const dbMocks = vi.hoisted(() => ({
  location: {
    delete: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  image: {
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  // why: route the transaction callback to the same stubs so call order
  // between the DB delete and storage cleanup can be asserted
  $transaction: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: dbMocks,
}));

// why: removePublicFiles calls Supabase storage over HTTP; mock it so the
// tests stay offline and can assert which files each request removes
const removePublicFilesMock = vi.hoisted(() => vi.fn());
vi.mock("~/utils/storage.server", () => ({
  MAX_PUBLIC_FILES_PER_REMOVE: 1000,
  removePublicFiles: removePublicFilesMock,
}));

const { deleteLocation, bulkDeleteLocations } = await import(
  "./service.server"
);

const STORAGE_PREFIX =
  "https://supabase.example.com/storage/v1/object/public/files/org-1/locations";

/** Public URL of a location's stored image, as `updateLocationImage` saves it. */
const imageUrlFor = (locationId: string) =>
  `${STORAGE_PREFIX}/${locationId}/img.jpg`;

/** Public URL of a location's stored thumbnail. */
const thumbnailUrlFor = (locationId: string) =>
  `${STORAGE_PREFIX}/${locationId}/img-thumbnail.jpg`;

/** Builds the fields of a location row the delete functions read. */
function makeLocation(
  id: string,
  overrides: Partial<{
    imageId: string | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
  }> = {}
) {
  return {
    id,
    organizationId: "org-1",
    imageId: null,
    imageUrl: imageUrlFor(id),
    thumbnailUrl: thumbnailUrlFor(id),
    ...overrides,
  };
}

// why: Logger.error writes to the console and Sentry; spy on it to assert a
// storage failure is logged without producing output
let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  loggerErrorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
  removePublicFilesMock.mockResolvedValue({ invalidUrlCount: 0 });
  dbMocks.$transaction.mockImplementation(
    (cb: (tx: typeof dbMocks) => Promise<unknown>) => cb(dbMocks)
  );
});

describe("deleteLocation", () => {
  it("removes the image and thumbnail files after the location row is deleted", async () => {
    dbMocks.location.delete.mockResolvedValue(makeLocation("loc-1"));

    const result = await deleteLocation({
      id: "loc-1",
      organizationId: "org-1",
    });

    expect(result.id).toBe("loc-1");
    expect(dbMocks.location.delete).toHaveBeenCalledWith({
      where: { id: "loc-1", organizationId: "org-1" },
    });
    // One storage request for both files.
    expect(removePublicFilesMock.mock.calls).toEqual([
      [{ publicUrls: [imageUrlFor("loc-1"), thumbnailUrlFor("loc-1")] }],
    ]);
    expect(dbMocks.location.delete.mock.invocationCallOrder[0]).toBeLessThan(
      removePublicFilesMock.mock.invocationCallOrder[0]
    );
  });

  it("deletes the legacy Image row and still removes the stored files", async () => {
    dbMocks.location.delete.mockResolvedValue(
      makeLocation("loc-1", { imageId: "image-1" })
    );

    await deleteLocation({ id: "loc-1", organizationId: "org-1" });

    expect(dbMocks.image.delete).toHaveBeenCalledWith({
      where: { id: "image-1" },
    });
    expect(removePublicFilesMock).toHaveBeenCalledWith({
      publicUrls: [imageUrlFor("loc-1"), thumbnailUrlFor("loc-1")],
    });
  });

  it("removes only the image when the location has no thumbnail", async () => {
    dbMocks.location.delete.mockResolvedValue(
      makeLocation("loc-1", { thumbnailUrl: null })
    );

    await deleteLocation({ id: "loc-1", organizationId: "org-1" });

    expect(removePublicFilesMock.mock.calls).toEqual([
      [{ publicUrls: [imageUrlFor("loc-1")] }],
    ]);
  });

  it("does not touch storage when the location has no image", async () => {
    dbMocks.location.delete.mockResolvedValue(
      makeLocation("loc-1", { imageUrl: null, thumbnailUrl: null })
    );

    await deleteLocation({ id: "loc-1", organizationId: "org-1" });

    expect(removePublicFilesMock).not.toHaveBeenCalled();
  });

  it("logs a storage failure and does not fail the delete", async () => {
    dbMocks.location.delete.mockResolvedValue(makeLocation("loc-1"));
    removePublicFilesMock.mockRejectedValueOnce(new Error("storage down"));

    await expect(
      deleteLocation({ id: "loc-1", organizationId: "org-1" })
    ).resolves.toMatchObject({ id: "loc-1" });

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to remove location images from storage during delete",
        additionalData: { locationIds: ["loc-1"] },
      })
    );
  });

  it("logs image URLs that are not in the public bucket", async () => {
    dbMocks.location.delete.mockResolvedValue(makeLocation("loc-1"));
    removePublicFilesMock.mockResolvedValueOnce({ invalidUrlCount: 2 });

    await deleteLocation({ id: "loc-1", organizationId: "org-1" });

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalData: { locationIds: ["loc-1"], invalidUrlCount: 2 },
      })
    );
  });

  it("leaves the files alone when the database delete fails", async () => {
    dbMocks.location.delete.mockRejectedValue(new Error("db down"));

    await expect(
      deleteLocation({ id: "loc-1", organizationId: "org-1" })
    ).rejects.toMatchObject({
      message: "Something went wrong while deleting the location",
    });

    expect(removePublicFilesMock).not.toHaveBeenCalled();
  });

  it("deletes the location and its legacy Image row in one transaction", async () => {
    dbMocks.location.delete.mockResolvedValue(
      makeLocation("loc-1", { imageId: "image-1" })
    );
    dbMocks.image.delete.mockRejectedValue(new Error("image delete failed"));

    await expect(
      deleteLocation({ id: "loc-1", organizationId: "org-1" })
    ).rejects.toMatchObject({
      message: "Something went wrong while deleting the location",
    });

    // Both deletes run inside the same transaction, so the failed Image
    // delete rolls the location back and its files must stay.
    expect(dbMocks.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMocks.location.delete).toHaveBeenCalledTimes(1);
    expect(dbMocks.image.delete).toHaveBeenCalledTimes(1);
    expect(removePublicFilesMock).not.toHaveBeenCalled();
  });
});

describe("bulkDeleteLocations", () => {
  // Bulk delete resolves once the transaction commits and removes the files
  // in the background, so these tests wait for the cleanup to settle.

  it("removes the files of every deleted location after the transaction commits", async () => {
    dbMocks.location.findMany.mockResolvedValue([
      makeLocation("loc-1"),
      makeLocation("loc-2", { thumbnailUrl: null }),
      makeLocation("loc-3", { imageUrl: null, thumbnailUrl: null }),
    ]);

    await bulkDeleteLocations({
      locationIds: ["loc-1", "loc-2", "loc-3"],
      organizationId: "org-1",
    });

    expect(dbMocks.location.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["loc-1", "loc-2", "loc-3"] },
        organizationId: "org-1",
      },
      select: { id: true, imageId: true, imageUrl: true, thumbnailUrl: true },
    });
    expect(dbMocks.location.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["loc-1", "loc-2", "loc-3"] } },
    });
    // Every file of the selection goes in one storage request.
    await vi.waitFor(() =>
      expect(removePublicFilesMock.mock.calls).toEqual([
        [
          {
            publicUrls: [
              imageUrlFor("loc-1"),
              thumbnailUrlFor("loc-1"),
              imageUrlFor("loc-2"),
            ],
          },
        ],
      ])
    );
    expect(
      dbMocks.location.deleteMany.mock.invocationCallOrder[0]
    ).toBeLessThan(removePublicFilesMock.mock.invocationCallOrder[0]);
  });

  it("resolves without waiting for the storage cleanup to finish", async () => {
    dbMocks.location.findMany.mockResolvedValue([makeLocation("loc-1")]);
    let releaseRemoval: () => void = () => {};
    removePublicFilesMock.mockImplementation(
      () =>
        new Promise<{ invalidUrlCount: number }>((resolve) => {
          releaseRemoval = () => resolve({ invalidUrlCount: 0 });
        })
    );

    await expect(
      bulkDeleteLocations({ locationIds: ["loc-1"], organizationId: "org-1" })
    ).resolves.toBeUndefined();

    // The storage request has started and is still pending.
    expect(removePublicFilesMock).toHaveBeenCalledTimes(1);
    releaseRemoval();
  });

  it("splits a large selection into requests the storage API accepts", async () => {
    // 1,200 locations with two files each: 500 locations (1,000 files) per
    // request, so three requests in total.
    const locations = Array.from({ length: 1200 }, (_, i) =>
      makeLocation(`loc-${i}`)
    );
    dbMocks.location.findMany.mockResolvedValue(locations);

    await bulkDeleteLocations({
      locationIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
    });

    expect(dbMocks.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1" } })
    );
    await vi.waitFor(() =>
      expect(removePublicFilesMock).toHaveBeenCalledTimes(3)
    );
    const sentUrls = removePublicFilesMock.mock.calls.map(
      ([{ publicUrls }]) => publicUrls as string[]
    );
    expect(sentUrls.map((urls) => urls.length)).toEqual([1000, 1000, 400]);
    expect(sentUrls.flat()).toEqual(
      locations.flatMap((location) => [
        location.imageUrl,
        location.thumbnailUrl,
      ])
    );
  });

  it("logs a failed request and still sends the next one", async () => {
    const locations = Array.from({ length: 600 }, (_, i) =>
      makeLocation(`loc-${i}`)
    );
    dbMocks.location.findMany.mockResolvedValue(locations);
    removePublicFilesMock.mockRejectedValueOnce(new Error("storage down"));

    await expect(
      bulkDeleteLocations({
        locationIds: [ALL_SELECTED_KEY],
        organizationId: "org-1",
      })
    ).resolves.toBeUndefined();

    await vi.waitFor(() =>
      expect(removePublicFilesMock).toHaveBeenCalledTimes(2)
    );
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalData: {
          locationIds: locations.slice(0, 500).map((location) => location.id),
        },
      })
    );
  });

  it("leaves the files alone when the transaction fails", async () => {
    dbMocks.location.findMany.mockResolvedValue([makeLocation("loc-1")]);
    dbMocks.location.deleteMany.mockRejectedValue(new Error("db down"));

    await expect(
      bulkDeleteLocations({ locationIds: ["loc-1"], organizationId: "org-1" })
    ).rejects.toMatchObject({
      message: "Something went wrong while bulk deleting locations.",
    });

    // Give any background cleanup a chance to start before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removePublicFilesMock).not.toHaveBeenCalled();
  });
});
