import {
  bulkArchiveResultMessage,
  draftBookingsNote,
} from "./archive-messages";

const draft = (name: string) => ({ id: name, name });

describe("draftBookingsNote", () => {
  it("says nothing when no draft holds the asset", () => {
    expect(draftBookingsNote([])).toBe("");
  });

  it("names the one draft", () => {
    expect(draftBookingsNote([draft("Shoot")])).toBe(
      ' It is still in the draft booking "Shoot", which can\'t be reserved until it is removed.'
    );
  });

  it("counts and names a few drafts for a bulk archive", () => {
    expect(draftBookingsNote([draft("A"), draft("B"), draft("C")], 4)).toBe(
      ' Some are still in 3 draft bookings ("A", "B" and 1 more), which can\'t be reserved until they are removed.'
    );
  });
});

describe("bulkArchiveResultMessage", () => {
  it("is not a success when nothing was archived", () => {
    expect(
      bulkArchiveResultMessage({ action: "archive", changed: 0, skipped: 1 })
    ).toEqual({
      title: "Nothing archived",
      message:
        "None of the 1 selected asset could be archived (checked out, in custody, in a reserved or checked-out booking, quantity-tracked, or already archived).",
      success: false,
    });
  });

  it("reports counts and the drafts still holding archived assets", () => {
    const result = bulkArchiveResultMessage({
      action: "archive",
      changed: 2,
      skipped: 0,
      draftBookings: [draft("Shoot")],
    });
    expect(result.success).toBe(true);
    expect(result.title).toBe("Assets archived");
    expect(result.message).toBe(
      '2 assets archived. Some are still in the draft booking "Shoot", which can\'t be reserved until they are removed.'
    );
  });

  it("words a reinstate run the same way", () => {
    expect(
      bulkArchiveResultMessage({ action: "reinstate", changed: 0, skipped: 2 })
        .title
    ).toBe("Nothing reinstated");
    expect(
      bulkArchiveResultMessage({ action: "reinstate", changed: 1, skipped: 1 })
        .message
    ).toBe(
      "1 reinstated, 1 skipped (not archived, or in a kit that is in custody or checked out)."
    );
  });
});
