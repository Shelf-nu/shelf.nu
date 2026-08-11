/**
 * Server-side custody redaction.
 *
 * `TeamMemberBadge` decides whether to DRAW a custodian's name, but the loader
 * shipped that name — and `user.email` — to every viewer regardless. A BASE
 * user with `baseUserCanSeeCustody` off saw "private" on screen while
 * `/kits.data` carried the custodian's name in plain text.
 *
 * These tests pin the server-side half: the identity must not leave the server
 * unless the viewer is allowed it, while the row itself still arrives so the
 * badge can render "private" and own-custody rows keep showing the owner.
 *
 * @see {@link file://./custody-visibility.server.ts}
 * @see {@link file://./permissions/custody-and-bookings-permissions.validator.client.ts}
 */
import { describe, expect, it } from "vitest";

import { redactCustodianForViewer } from "./custody-visibility.server";

const VIEWER = "user-viewer";
const COLLEAGUE = "user-colleague";

/** A row shaped like the list includes produce. */
function rowHeldBy(userId: string | null, name = "Someone Else") {
  return {
    id: "kit-1",
    name: "Ranged Equipment",
    custody: {
      custodian: {
        userId,
        name,
        user: userId
          ? {
              id: userId,
              firstName: "Some",
              lastName: "One",
              displayName: null,
              profilePicture: null,
              email: "someone@example.com",
            }
          : null,
      },
    },
  };
}

describe("redactCustodianForViewer", () => {
  it("leaves everything alone when the viewer may see all custody", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: true,
      userId: VIEWER,
    });

    expect(out[0].custody?.custodian?.name).toBe("Someone Else");
    expect(out[0].custody?.custodian?.user?.email).toBe("someone@example.com");
  });

  it("strips a colleague's identity when the viewer may not see all custody", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // The leak: name and email used to ship regardless of the badge's gate.
    expect(JSON.stringify(out)).not.toContain("Someone Else");
    expect(JSON.stringify(out)).not.toContain("someone@example.com");
  });

  it("keeps the row itself so the badge can still render `private`", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // Dropping `custody` entirely would turn the "private" chip into a blank
    // cell, losing the signal that the item IS held by someone.
    expect(out[0].custody).toBeTruthy();
    expect(out[0].custody?.custodian).toBeTruthy();
  });

  it("keeps the viewer's OWN custody visible", () => {
    const rows = [rowHeldBy(VIEWER, "Me Myself")];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // `userCanViewSpecificCustody` allows this, so redacting it would be a
    // regression: the owner would see "private" on their own item.
    expect(out[0].custody?.custodian?.name).toBe("Me Myself");
    expect(out[0].custody?.custodian?.user?.id).toBe(VIEWER);
  });

  it("strips an NRM custodian, who has no user to compare against", () => {
    const rows = [rowHeldBy(null, "Woox")];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // The exact case observed in the browser: NRM custodians have no user, so
    // a "is this me?" check can never match — they must be redacted.
    expect(JSON.stringify(out)).not.toContain("Woox");
    expect(out[0].custody?.custodian).toBeTruthy();
  });

  it("leaves rows with no custody untouched", () => {
    const rows = [{ id: "kit-2", name: "Free", custody: null }];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    expect(out[0].custody).toBeNull();
  });

  it("does not mutate the caller's array", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // Prisma results get reused by callers; redaction must not reach back.
    expect(rows[0].custody?.custodian?.name).toBe("Someone Else");
  });
});
