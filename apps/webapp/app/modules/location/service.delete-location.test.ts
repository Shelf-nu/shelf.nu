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

// why: removePublicFile calls Supabase storage over HTTP; mock it so the
// tests stay offline and can assert which files are removed
const removePublicFileMock = vi.hoisted(() => vi.fn());
vi.mock("~/utils/storage.server", () => ({
  removePublicFile: removePublicFileMock,
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
  removePublicFileMock.mockResolvedValue(undefined);
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
    expect(removePublicFileMock.mock.calls).toEqual([
      [{ publicUrl: imageUrlFor("loc-1") }],
      [{ publicUrl: thumbnailUrlFor("loc-1") }],
    ]);
    expect(dbMocks.location.delete.mock.invocationCallOrder[0]).toBeLessThan(
      removePublicFileMock.mock.invocationCallOrder[0]
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
    expect(removePublicFileMock).toHaveBeenCalledTimes(2);
  });

  it("removes only the image when the location has no thumbnail", async () => {
    dbMocks.location.delete.mockResolvedValue(
      makeLocation("loc-1", { thumbnailUrl: null })
    );

    await deleteLocation({ id: "loc-1", organizationId: "org-1" });

    expect(removePublicFileMock.mock.calls).toEqual([
      [{ publicUrl: imageUrlFor("loc-1") }],
    ]);
  });

  it("does not touch storage when the location has no image", async () => {
    dbMocks.location.delete.mockResolvedValue(
      makeLocation("loc-1", { imageUrl: null, thumbnailUrl: null })
    );

    await deleteLocation({ id: "loc-1", organizationId: "org-1" });

    expect(removePublicFileMock).not.toHaveBeenCalled();
  });

  it("logs a storage failure, keeps going, and does not fail the delete", async () => {
    dbMocks.location.delete.mockResolvedValue(makeLocation("loc-1"));
    removePublicFileMock.mockRejectedValueOnce(new Error("storage down"));

    await expect(
      deleteLocation({ id: "loc-1", organizationId: "org-1" })
    ).resolves.toMatchObject({ id: "loc-1" });

    // The thumbnail is still attempted after the image removal fails.
    expect(removePublicFileMock).toHaveBeenCalledTimes(2);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to remove location image from storage during delete",
        additionalData: {
          locationId: "loc-1",
          storageError: "storage down",
        },
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

    expect(removePublicFileMock).not.toHaveBeenCalled();
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
    expect(removePublicFileMock).not.toHaveBeenCalled();
  });
});

describe("bulkDeleteLocations", () => {
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
    // Locations in a batch are cleaned up in parallel, so compare as a set.
    expect(removePublicFileMock).toHaveBeenCalledTimes(3);
    expect(removePublicFileMock.mock.calls).toEqual(
      expect.arrayContaining([
        [{ publicUrl: imageUrlFor("loc-1") }],
        [{ publicUrl: thumbnailUrlFor("loc-1") }],
        [{ publicUrl: imageUrlFor("loc-2") }],
      ])
    );
    expect(
      dbMocks.location.deleteMany.mock.invocationCallOrder[0]
    ).toBeLessThan(removePublicFileMock.mock.invocationCallOrder[0]);
  });

  it("removes files for every location across cleanup batches", async () => {
    const locations = Array.from({ length: 23 }, (_, i) =>
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
    expect(removePublicFileMock).toHaveBeenCalledTimes(46);
    for (const location of locations) {
      expect(removePublicFileMock).toHaveBeenCalledWith({
        publicUrl: location.imageUrl,
      });
      expect(removePublicFileMock).toHaveBeenCalledWith({
        publicUrl: location.thumbnailUrl,
      });
    }
  });

  it("logs a storage failure and still removes the other files", async () => {
    dbMocks.location.findMany.mockResolvedValue([
      makeLocation("loc-1", { thumbnailUrl: null }),
      makeLocation("loc-2"),
    ]);
    removePublicFileMock.mockRejectedValueOnce(new Error("storage down"));

    await expect(
      bulkDeleteLocations({
        locationIds: ["loc-1", "loc-2"],
        organizationId: "org-1",
      })
    ).resolves.toBeUndefined();

    expect(removePublicFileMock).toHaveBeenCalledTimes(3);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalData: {
          locationId: "loc-1",
          storageError: "storage down",
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

    expect(removePublicFileMock).not.toHaveBeenCalled();
  });
});
