import { readArchivedRefusalDetails } from "./archived-refusal";
import { ShelfError } from "./error";

describe("readArchivedRefusalDetails", () => {
  const refusal = new ShelfError({
    cause: null,
    label: "Request validation",
    message: '"Cam A" is archived. Remove it from the list and try again.',
    status: 400,
    additionalData: {
      organizationId: "org-1",
      archivedAssetIds: ["a-1"],
      archivedAssetTitles: ["Cam A"],
    },
  });

  it("reads the ids from the refusal itself", () => {
    expect(readArchivedRefusalDetails(refusal)).toEqual({
      archivedAssetIds: ["a-1"],
      archivedAssetTitles: ["Cam A"],
      kitIdsWithoutActiveAssets: [],
    });
  });

  it("finds them under a wrapper that replaced additionalData", () => {
    const wrapped = new ShelfError({
      cause: new ShelfError({
        cause: refusal,
        label: "Assets",
        message: refusal.message,
        additionalData: { assetIds: ["a-1", "a-2"] },
      }),
      label: "Assets",
      message: refusal.message,
      additionalData: { userId: "u-1" },
    });

    expect(readArchivedRefusalDetails(wrapped)?.archivedAssetIds).toEqual([
      "a-1",
    ]);
  });

  it("reads the kits an empty-kit refusal names", () => {
    const kitRefusal = new ShelfError({
      cause: null,
      label: "Kit",
      message: "Kit has no active assets",
      status: 400,
      additionalData: { kitIdsWithoutActiveAssets: ["k-1"] },
    });

    expect(readArchivedRefusalDetails(kitRefusal)).toEqual({
      archivedAssetIds: [],
      archivedAssetTitles: [],
      kitIdsWithoutActiveAssets: ["k-1"],
    });
  });

  it("returns null for any other error", () => {
    expect(readArchivedRefusalDetails(new Error("boom"))).toBeNull();
    expect(readArchivedRefusalDetails(null)).toBeNull();
    expect(
      readArchivedRefusalDetails(
        new ShelfError({ cause: null, label: "Assets", message: "nope" })
      )
    ).toBeNull();
  });
});
