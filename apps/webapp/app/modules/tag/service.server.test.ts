import { BookingStatus, TagUseFor } from "@prisma/client";
import { describe, vitest } from "vitest";
import { USER_ID, ORGANIZATION_ID } from "@factories";
import { db } from "~/database/db.server";
import { bookingDraftVisibilityClause } from "~/modules/booking/draft-visibility";
import { createTag, getTags, updateTag } from "~/modules/tag/service.server";

// why: avoid database dependency and test tag service business logic in isolation
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
    tag: {
      create: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
      findMany: vitest.fn().mockResolvedValue([]),
      count: vitest.fn().mockResolvedValue(0),
    },
  },
}));

describe("tag service", () => {
  beforeEach(() => {
    vitest.resetAllMocks();
  });

  describe("create", () => {
    it("should create tag", async () => {
      await createTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        name: "test_tag",
        color: "#ffffff",
        useFor: [TagUseFor.ASSET],
      });
      expectTagToBeCreated({
        name: "test_tag",
        description: "my test tag",
        color: "#ffffff",
        useFor: [TagUseFor.ASSET],
      });
    });

    it("should trim tag name", async () => {
      await createTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        name: " test_tag ",
        color: "#ffffff",
        useFor: [TagUseFor.ASSET],
      });
      expectTagToBeCreated({
        name: "test_tag",
        description: "my test tag",
        color: "#ffffff",
        useFor: [TagUseFor.ASSET],
      });
    });
  });

  describe("getTags", () => {
    it("counts the assets and bookings the linked lists show by default", async () => {
      await getTags({
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        request: new Request("http://localhost/tags"),
      });

      // The tags list links each count to the asset and bookings indexes, so
      // each count must match what those lists show the viewer.
      expect(db.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            _count: {
              select: {
                assets: { where: { archivedAt: null } },
                bookings: {
                  where: {
                    status: {
                      notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED],
                    },
                    ...bookingDraftVisibilityClause(USER_ID),
                  },
                },
              },
            },
          },
        })
      );
    });
  });

  describe("update", () => {
    it("should update tag", async () => {
      await updateTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        name: "test_tag",
        color: "#ffffff",
      });
      expectTagToBeUpdated({
        name: "test_tag",
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        color: "#ffffff",
      });
    });

    it("should trim tag name on update", async () => {
      await updateTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        name: " test_tag ",
        color: "#ffffff",
      });
      expectTagToBeUpdated({
        name: "test_tag",
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        color: "#ffffff",
      });
    });

    it("should update tag with useFor", async () => {
      await updateTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        name: "test_tag",
        color: "#ffffff",
        useFor: [TagUseFor.ASSET],
      });
      expectTagToBeUpdated({
        name: "test_tag",
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        color: "#ffffff",
        useFor: [TagUseFor.ASSET],
      });
    });
  });
});

function expectTagToBeCreated({
  name,
  description,
  color,
  useFor,
}: {
  name: string;
  description: string;
  color: string;
  useFor: TagUseFor[];
}): void {
  expect(db.tag.create).toHaveBeenCalledWith({
    data: {
      name,
      description,
      color,
      useFor,
      user: {
        connect: {
          id: USER_ID,
        },
      },
      organization: {
        connect: {
          id: ORGANIZATION_ID,
        },
      },
    },
  });
}

function expectTagToBeUpdated({
  name,
  description,
  id,
  organizationId,
  color,
  useFor,
}: {
  name: string;
  description: string;
  id: string;
  organizationId: string;
  color: string;
  useFor?: TagUseFor[];
}): void {
  expect(db.tag.update).toHaveBeenCalledWith({
    where: {
      id,
      organizationId,
    },
    data: {
      name,
      description,
      color,
      useFor: {
        set: useFor,
      },
    },
  });
}
