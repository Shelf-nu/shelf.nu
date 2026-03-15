import { TagUseFor } from "@shelf/database";
import { describe, vitest } from "vitest";
import { USER_ID, ORGANIZATION_ID } from "@factories";
import { db } from "~/database/db.server";
import { create, update } from "~/database/query-helpers.server";
import { createTag, updateTag } from "~/modules/tag/service.server";

// why: avoid database dependency and test tag service business logic in isolation
vitest.mock("~/database/db.server", () => ({ db: {} }));
vitest.mock("~/database/query-helpers.server", () => ({
  create: vitest.fn().mockResolvedValue({}),
  update: vitest.fn().mockResolvedValue({}),
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
  expect(create).toHaveBeenCalledWith(db, "Tag", {
    name,
    description,
    color,
    useFor,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
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
  expect(update).toHaveBeenCalledWith(db, "Tag", {
    where: { id, organizationId },
    data: {
      name,
      description,
      color,
      useFor,
    },
  });
}
