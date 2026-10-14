import { archivedHiddenEmptyState } from "./archived-hidden-empty-state";

describe("archivedHiddenEmptyState", () => {
  it("is null when nothing archived is hidden", () => {
    expect(
      archivedHiddenEmptyState({
        archivedCount: 0,
        canArchiveAssets: true,
        place: "kit",
      })
    ).toBeNull();
  });

  it("points a member who can archive at the Archived view", () => {
    expect(
      archivedHiddenEmptyState({
        archivedCount: 1,
        canArchiveAssets: true,
        place: "kit",
      })
    ).toEqual({
      title: "No active assets in this kit",
      text: "1 archived asset is hidden from this view. Pick Archived from the menu on the list title to see it.",
    });
    expect(
      archivedHiddenEmptyState({
        archivedCount: 3,
        canArchiveAssets: true,
        place: "location",
      })?.text
    ).toBe(
      "3 archived assets are hidden from this view. Pick Archived from the menu on the list title to see them."
    );
  });

  it("never sends a member without the Archived view to it", () => {
    const state = archivedHiddenEmptyState({
      archivedCount: 2,
      canArchiveAssets: false,
      place: "location",
    });
    expect(state?.title).toBe("No active assets at this location");
    expect(state?.text).toBe(
      "Archived assets are hidden from your view. Ask an admin to check."
    );
  });
});
