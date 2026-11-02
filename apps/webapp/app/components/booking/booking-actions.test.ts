/**
 * The booking action rules: which actions a viewer is offered on a booking,
 * and which are shown but disabled.
 *
 * The rules are pure, so nothing here is mocked: the viewer's `access` comes
 * from the real `resolveRoleAccess` (through the shared `accessFor` helper),
 * never from a hand-written object that the policy table might not produce.
 *
 * @see {@link file://./booking-actions.ts}
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { accessFor } from "@helpers/role-access";
import type { ExplicitScanSettings } from "~/utils/permissions/role-access";
import {
  ASSIGN_UNITS_FIRST_REASON,
  NO_ASSETS_PDF_REASON,
  NO_CHECKIN_RECEIPT_REASON,
  canActOnBooking,
  canQuickMove,
  resolveBookingActions,
} from "./booking-actions";
import type {
  BookingActionKey,
  BookingActions,
  BookingActionsBooking,
} from "./booking-actions";

/** The signed-in viewer. */
const ME = "user-me";

/** Somebody else. */
const OTHER = "user-other";

/** No workspace requires the explicit flow. */
const NO_EXPLICIT_SCAN: ExplicitScanSettings = {
  requireExplicitCheckoutForAdmin: false,
  requireExplicitCheckoutForSelfService: false,
  requireExplicitCheckinForAdmin: false,
  requireExplicitCheckinForSelfService: false,
};

/** Every action key, in the order the rules return them. */
const ALL_KEYS: BookingActionKey[] = [
  "checkOut",
  "checkOutRemaining",
  "checkIn",
  "extend",
  "cancel",
  "archive",
  "duplicate",
  "bookingDocument",
  "checkinReceipt",
  "revertToDraft",
  "delete",
  "manageNotifications",
];

/** A custodian-less RESERVED booking ending far in the future, with assets. */
function buildBooking(
  overrides: Partial<BookingActionsBooking> = {}
): BookingActionsBooking {
  return {
    status: BookingStatus.RESERVED,
    to: new Date("2099-01-01T00:00:00Z"),
    custodianUserId: null,
    custodianTeamMemberUserId: null,
    assetCount: 3,
    modelRequests: [],
    hasItemsToCheckOut: true,
    canPrintCheckinReceipt: true,
    ...overrides,
  };
}

/** Resolves the actions for a viewer holding `roles`. */
function resolveFor(
  booking: BookingActionsBooking,
  {
    roles = [OrganizationRoles.OWNER],
    userId = ME,
    settings = NO_EXPLICIT_SCAN,
  }: {
    roles?: OrganizationRoles[];
    userId?: string;
    settings?: ExplicitScanSettings;
  } = {}
): BookingActions {
  return resolveBookingActions({
    booking,
    viewer: {
      userId,
      roles,
      access: accessFor(roles),
      bookingSettings: settings,
    },
  });
}

/** The keys of the actions that are offered. */
function visibleKeys(actions: BookingActions): BookingActionKey[] {
  return ALL_KEYS.filter((key) => actions[key].visible);
}

/** Actions every booking offers an Owner, whatever its status. */
const ALWAYS: BookingActionKey[] = [
  "duplicate",
  "bookingDocument",
  "checkinReceipt",
  "delete",
];

/** What an Owner sees per status, besides {@link ALWAYS}. */
const OWNER_EXTRAS: Record<BookingStatus, BookingActionKey[]> = {
  [BookingStatus.DRAFT]: ["manageNotifications"],
  [BookingStatus.RESERVED]: [
    "checkOut",
    "cancel",
    "revertToDraft",
    "manageNotifications",
  ],
  [BookingStatus.ONGOING]: [
    "checkOutRemaining",
    "checkIn",
    "extend",
    "cancel",
    "manageNotifications",
  ],
  [BookingStatus.OVERDUE]: [
    "checkOutRemaining",
    "checkIn",
    "extend",
    "cancel",
    "manageNotifications",
  ],
  [BookingStatus.COMPLETE]: ["archive"],
  [BookingStatus.ARCHIVED]: [],
  [BookingStatus.CANCELLED]: [],
};

describe("resolveBookingActions: an Owner, by status", () => {
  it.each(Object.values(BookingStatus))(
    "offers exactly the actions %s allows",
    (status) => {
      const actions = resolveFor(buildBooking({ status }));
      const expected = new Set([...ALWAYS, ...OWNER_EXTRAS[status]]);

      for (const key of ALL_KEYS) {
        expect(
          { key, visible: actions[key].visible },
          `${key} while ${status}`
        ).toEqual({ key, visible: expected.has(key) });
      }
    }
  );

  it("offers Archive on a RESERVED booking only once its end has passed", () => {
    const past = resolveFor(
      buildBooking({ to: new Date("2020-01-01T00:00:00Z") })
    );
    const future = resolveFor(buildBooking());

    expect(past.archive.visible).toBe(true);
    expect(future.archive.visible).toBe(false);
  });

  it("offers Check out remaining only when items are still booked", () => {
    const actions = resolveFor(
      buildBooking({ status: BookingStatus.ONGOING, hasItemsToCheckOut: false })
    );

    expect(actions.checkOutRemaining.visible).toBe(false);
    expect(actions.checkIn.visible).toBe(true);
  });

  it("reads a booking without the flag as having nothing left to check out", () => {
    const actions = resolveFor(
      buildBooking({
        status: BookingStatus.ONGOING,
        hasItemsToCheckOut: undefined,
      })
    );

    expect(actions.checkOutRemaining.visible).toBe(false);
  });

  it("disables an unavailable check-in receipt with the generic reason", () => {
    const absent = resolveFor(
      buildBooking({ canPrintCheckinReceipt: undefined })
    );
    const unavailable = resolveFor(
      buildBooking({ canPrintCheckinReceipt: false })
    );

    for (const actions of [absent, unavailable]) {
      expect(actions.checkinReceipt).toEqual({
        visible: true,
        disabled: { reason: NO_CHECKIN_RECEIPT_REASON },
      });
    }
  });

  it("disables an unavailable check-in receipt with the booking's own reason", () => {
    const actions = resolveFor(
      buildBooking({
        canPrintCheckinReceipt: false,
        checkinReceiptUnavailableReason: "Nothing has been returned yet.",
      })
    );

    expect(actions.checkinReceipt).toEqual({
      visible: true,
      disabled: { reason: "Nothing has been returned yet." },
    });
  });

  it("enables an available check-in receipt whatever reason is passed", () => {
    const actions = resolveFor(
      buildBooking({
        canPrintCheckinReceipt: true,
        checkinReceiptUnavailableReason: "Unused",
      })
    );

    expect(actions.checkinReceipt).toEqual({ visible: true, disabled: false });
  });
});

describe("resolveBookingActions: who may act", () => {
  it("hides every action from a Self Service viewer who created but does not hold the booking", () => {
    const actions = resolveFor(
      buildBooking({ status: BookingStatus.RESERVED, custodianUserId: OTHER }),
      { roles: [OrganizationRoles.SELF_SERVICE] }
    );

    expect(visibleKeys(actions)).toEqual([]);
  });

  it("shows a Self Service custodian check out, cancel, extend, archive on their own booking", () => {
    const own = { custodianUserId: ME };
    const reserved = resolveFor(
      buildBooking({
        ...own,
        status: BookingStatus.RESERVED,
        to: new Date("2020-01-01T00:00:00Z"),
      }),
      { roles: [OrganizationRoles.SELF_SERVICE] }
    );
    const ongoing = resolveFor(
      buildBooking({ ...own, status: BookingStatus.ONGOING }),
      { roles: [OrganizationRoles.SELF_SERVICE] }
    );
    const complete = resolveFor(
      buildBooking({ ...own, status: BookingStatus.COMPLETE }),
      { roles: [OrganizationRoles.SELF_SERVICE] }
    );

    expect(reserved.checkOut.visible).toBe(true);
    expect(reserved.cancel.visible).toBe(true);
    expect(reserved.archive.visible).toBe(true);
    expect(ongoing.extend.visible).toBe(true);
    expect(complete.archive.visible).toBe(true);
  });

  it("matches custody through the team-member link", () => {
    const actions = resolveFor(
      buildBooking({
        status: BookingStatus.ONGOING,
        custodianUserId: null,
        custodianTeamMemberUserId: ME,
      }),
      { roles: [OrganizationRoles.SELF_SERVICE] }
    );

    expect(actions.checkIn.visible).toBe(true);
    expect(actions.duplicate.visible).toBe(true);
  });

  it("never offers Base check out, check in, extend, cancel or archive", () => {
    const statuses = Object.values(BookingStatus);
    for (const status of statuses) {
      const actions = resolveFor(
        buildBooking({
          status,
          custodianUserId: ME,
          to: new Date("2020-01-01T00:00:00Z"),
        }),
        { roles: [OrganizationRoles.BASE] }
      );

      for (const key of [
        "checkOut",
        "checkOutRemaining",
        "checkIn",
        "extend",
        "cancel",
        "archive",
      ] as const) {
        expect(actions[key].visible, `${key} while ${status}`).toBe(false);
      }
    }
  });

  it("still offers a Base custodian Duplicate and the booking document", () => {
    const actions = resolveFor(buildBooking({ custodianUserId: ME }), {
      roles: [OrganizationRoles.BASE],
    });

    expect(actions.duplicate.visible).toBe(true);
    expect(actions.bookingDocument.visible).toBe(true);
  });

  it("limits a Self Service custodian's Delete to drafts", () => {
    const own = { custodianUserId: ME };
    const roles = [OrganizationRoles.SELF_SERVICE];

    expect(
      resolveFor(buildBooking({ ...own, status: BookingStatus.DRAFT }), {
        roles,
      }).delete.visible
    ).toBe(true);
    expect(
      resolveFor(buildBooking({ ...own, status: BookingStatus.RESERVED }), {
        roles,
      }).delete.visible
    ).toBe(false);
  });

  it("keeps the PDFs from a role that may not download others' documents on someone else's booking", () => {
    // Only a role that writes every booking can reach another's booking, and
    // every such role may download documents for others.
    const actions = resolveFor(buildBooking({ custodianUserId: OTHER }), {
      roles: [OrganizationRoles.ADMIN],
    });

    expect(actions.bookingDocument.visible).toBe(true);
    expect(actions.checkinReceipt.visible).toBe(true);
  });
});

describe("resolveBookingActions: explicit scan mode", () => {
  it("drops checkOut and checkOutRemaining when explicit check-out applies", () => {
    const settings = {
      ...NO_EXPLICIT_SCAN,
      requireExplicitCheckoutForAdmin: true,
    };

    const reserved = resolveFor(buildBooking(), {
      roles: [OrganizationRoles.ADMIN],
      settings,
    });
    const ongoing = resolveFor(
      buildBooking({ status: BookingStatus.ONGOING }),
      { roles: [OrganizationRoles.ADMIN], settings }
    );

    expect(reserved.checkOut.visible).toBe(false);
    expect(ongoing.checkOutRemaining.visible).toBe(false);
    expect(ongoing.checkIn.visible).toBe(true);
  });

  it("drops checkIn when explicit check-in applies", () => {
    const actions = resolveFor(
      buildBooking({ status: BookingStatus.ONGOING }),
      {
        roles: [OrganizationRoles.ADMIN],
        settings: { ...NO_EXPLICIT_SCAN, requireExplicitCheckinForAdmin: true },
      }
    );

    expect(actions.checkIn.visible).toBe(false);
    expect(actions.checkOutRemaining.visible).toBe(true);
  });

  it("reads the Self Service switches for a Self Service viewer, not the admin ones", () => {
    const actions = resolveFor(buildBooking({ custodianUserId: ME }), {
      roles: [OrganizationRoles.SELF_SERVICE],
      settings: {
        ...NO_EXPLICIT_SCAN,
        requireExplicitCheckoutForSelfService: true,
      },
    });

    expect(actions.checkOut.visible).toBe(false);
  });
});

describe("resolveBookingActions: disabled states", () => {
  it("disables checkOut while model units are unassigned", () => {
    const actions = resolveFor(
      buildBooking({
        modelRequests: [
          { quantity: 2, fulfilledQuantity: 1, fulfilledAt: null },
        ],
      })
    );

    expect(actions.checkOut).toEqual({
      visible: true,
      disabled: {
        title: "Can't check out yet",
        reason: ASSIGN_UNITS_FIRST_REASON,
      },
    });
  });

  it("keeps checkOut enabled once every reserved unit is assigned", () => {
    const actions = resolveFor(
      buildBooking({
        modelRequests: [
          {
            quantity: 2,
            fulfilledQuantity: 2,
            fulfilledAt: new Date("2026-08-01T08:00:00Z"),
          },
        ],
      })
    );

    expect(actions.checkOut).toEqual({ visible: true, disabled: false });
  });

  it("disables bookingDocument with no assets", () => {
    const actions = resolveFor(buildBooking({ assetCount: 0 }));

    expect(actions.bookingDocument).toEqual({
      visible: true,
      disabled: { reason: NO_ASSETS_PDF_REASON },
    });
  });
});

describe("canActOnBooking", () => {
  const writesAll = accessFor([OrganizationRoles.ADMIN]);
  const writesOwn = accessFor([OrganizationRoles.SELF_SERVICE]);
  const nobody = { custodianUserId: null, custodianTeamMemberUserId: null };

  it("lets a role that writes every booking act on any booking", () => {
    expect(
      canActOnBooking({ booking: nobody, userId: ME, access: writesAll })
    ).toBe(true);
  });

  it("lets a holder act through either custody link", () => {
    expect(
      canActOnBooking({
        booking: { ...nobody, custodianUserId: ME },
        userId: ME,
        access: writesOwn,
      })
    ).toBe(true);
    expect(
      canActOnBooking({
        booking: { ...nobody, custodianTeamMemberUserId: ME },
        userId: ME,
        access: writesOwn,
      })
    ).toBe(true);
  });

  it("refuses a member held to their own bookings on someone else's", () => {
    expect(
      canActOnBooking({
        booking: { ...nobody, custodianUserId: OTHER },
        userId: ME,
        access: writesOwn,
      })
    ).toBe(false);
  });
});

describe("canQuickMove", () => {
  const admin = [OrganizationRoles.ADMIN];

  it("allows a holder of the grant outside explicit mode", () => {
    expect(
      canQuickMove({
        roles: admin,
        access: accessFor(admin),
        settings: NO_EXPLICIT_SCAN,
        direction: "checkout",
      })
    ).toBe(true);
  });

  it("refuses a role without the grant", () => {
    const base = [OrganizationRoles.BASE];

    expect(
      canQuickMove({
        roles: base,
        access: accessFor(base),
        settings: NO_EXPLICIT_SCAN,
        direction: "checkin",
      })
    ).toBe(false);
  });

  it("refuses the direction the workspace holds to the explicit flow", () => {
    const settings = {
      ...NO_EXPLICIT_SCAN,
      requireExplicitCheckinForAdmin: true,
    };

    expect(
      canQuickMove({
        roles: admin,
        access: accessFor(admin),
        settings,
        direction: "checkin",
      })
    ).toBe(false);
    expect(
      canQuickMove({
        roles: admin,
        access: accessFor(admin),
        settings,
        direction: "checkout",
      })
    ).toBe(true);
  });
});
