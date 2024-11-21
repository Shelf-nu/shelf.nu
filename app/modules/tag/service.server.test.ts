import { vitest } from "vitest";
import { ORGANIZATION_ID, USER_ID } from "mocks/user";
import { db } from "~/database/db.server";
import { createTag } from "~/modules/tag/service.server";

vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
    tag: {
      create: vitest.fn().mockResolvedValue({}),
    },
  },
}));

describe("tag service creation", () => {
  beforeEach(() => {
    vitest.resetAllMocks();
  });

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
