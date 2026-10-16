/**
 * The activity line a system note renders.
 *
 * Booking check-outs and check-ins write a system note that ends with how the
 * batch was made ("scanned on the phone"). The line reaches the reader through
 * this component, so the case pins that the words survive the Markdoc render
 * next to the entity links the note carries.
 *
 * @see {@link file://./note.tsx}
 * @see {@link file://../../../modules/booking/checkout-method.ts}
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { Note } from "./note";

// why: the note's date tag reads the acting user's format prefs through this
// hook, which reaches the root route loader; there is no router data here.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    formatDate: () => "01/10/2026 10:00",
    formatTime: () => "10:00",
    formatDateTime: () => "01/10/2026 10:00",
  }),
}));

describe("Note: the booking activity line", () => {
  it("says how a check-out was made after what was checked out", () => {
    render(
      <MemoryRouter>
        <ul>
          <Note
            note={{
              id: "note-1",
              type: "UPDATE",
              createdAt: "2026-10-01T10:00:00.000Z",
              content:
                '{% link to="/settings/team/users/user-1" text="Ada Lovelace" /%} performed a partial check-out: {% link to="/assets/asset-1" text="Tripod" /%} (scanned on the phone).',
            }}
          />
        </ul>
      </MemoryRouter>
    );

    // The link component carries an inline style block, so the match is on the
    // sentence, not on the element's whole text.
    const line = screen.getByText(/performed a partial check-out/);
    expect(line).toHaveTextContent(
      /Ada Lovelace performed a partial check-out: .*Tripod.*\(scanned on the phone\)\./
    );
  });
});
