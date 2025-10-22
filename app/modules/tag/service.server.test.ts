import { TagUseFor } from "@prisma/client";
import { describe, vitest } from "vitest";
import { USER_ID, ORGANIZATION_ID } from "@factories";
import { db } from "~/database/db.server";
import { createTag, updateTag } from "~/modules/tag/service.server";

// why: avoid database dependency and test tag service business logic in isolation
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
    tag: {
      create: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
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
        useFor: [TagUseFor.ASSET],
      });
      expectTagToBeCreated({
        name: "test_tag",
        description: "my test tag",
        useFor: [TagUseFor.ASSET],
      });
    });

    it("should trim tag name", async () => {
      await createTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        name: " test_tag ",
        useFor: [TagUseFor.ASSET],
      });
      expectTagToBeCreated({
        name: "test_tag",
        description: "my test tag",
        useFor: [TagUseFor.ASSET],
      });
    });
  });

  describe("update", () => {
    it("should update tag", async () => {
      await updateTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        name: "test_tag",
      });
      expectTagToBeUpdated({
        name: "test_tag",
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
      });
    });

    it("should trim tag name on update", async () => {
      await updateTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        name: " test_tag ",
      });
      expectTagToBeUpdated({
        name: "test_tag",
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
      });
    });

    it("should update tag with useFor", async () => {
      await updateTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        name: "test_tag",
        useFor: [TagUseFor.ASSET],
      });
      expectTagToBeUpdated({
        name: "test_tag",
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        id: USER_ID,
        useFor: [TagUseFor.ASSET],
      });
    });
  });
});

function expectTagToBeCreated({
  name,
  description,
  useFor,
}: {
  name: string;
  description: string;
  useFor: TagUseFor[];
}): void {
  expect(db.tag.create).toHaveBeenCalledWith({
    data: {
      name,
      description,
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
  useFor,
}: {
  name: string;
  description: string;
  id: string;
  organizationId: string;
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
      useFor: {
        set: useFor,
      },
    },
  });
}
