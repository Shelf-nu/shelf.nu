import { describe, vitest } from "vitest";
import { ORGANIZATION_ID, USER_ID } from "mocks/user";
import { db } from "~/database/db.server";
import { createTag, updateTag } from "~/modules/tag/service.server";

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
      });
      expectTagToBeCreated({ name: "test_tag", description: "my test tag" });
    });

    it("should trim tag name", async () => {
      await createTag({
        description: "my test tag",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        name: " test_tag ",
      });
      expectTagToBeCreated({ name: "test_tag", description: "my test tag" });
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
  });
});

function expectTagToBeCreated({
  name,
  description,
}: {
  name: string;
  description: string;
}): void {
  expect(db.tag.create).toHaveBeenCalledWith({
    data: {
      name,
      description,
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
}: {
  name: string;
  description: string;
  id: string;
  organizationId: string;
}): void {
  expect(db.tag.update).toHaveBeenCalledWith({
    where: {
      id,
      organizationId,
    },
    data: {
      name,
      description,
    },
  });
}
