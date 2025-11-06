import { json } from "@remix-run/node";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { loader } from "~/routes/_layout+/account-details.workspace.new";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import { assertUserCanCreateMoreOrganizations } from "~/utils/subscription.server";

// why: the loader uses json helper to send data responses; mock to inspect payload directly
vi.mock("@remix-run/node", async () => {
  const actual = await vi.importActual<typeof import("@remix-run/node")>(
    "@remix-run/node"
  );

  return {
    ...actual,
    json: vi.fn((data) => data),
  };
});

// why: loader reads selected organisation context to determine current organization id
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganisation: vi.fn(),
}));

// why: route imports organization service which initializes Prisma client
vi.mock("~/modules/organization/service.server", () => ({
  createOrganization: vi.fn(),
}));

// why: loader ensures subscription limits before returning data
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanCreateMoreOrganizations: vi.fn(),
}));

const jsonMock = vi.mocked(json);
const getSelectedOrganisationMock = vi.mocked(getSelectedOrganisation);
const assertUserCanCreateMoreOrganizationsMock = vi.mocked(
  assertUserCanCreateMoreOrganizations
);

const mockContext = {
  getSession: () => ({ userId: "user-123" }),
} as any;

describe("account-details.workspace.new loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSelectedOrganisationMock.mockResolvedValue({
      organizationId: "org-123",
    });
    assertUserCanCreateMoreOrganizationsMock.mockResolvedValue(undefined);
  });

  it("includes Taiwanese Dollars currency option", async () => {
    await loader({
      context: mockContext,
      request: new Request("http://localhost/account-details/workspace/new"),
      params: {},
    });

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        curriences: expect.arrayContaining(["TWD"]),
      })
    );
  });
});
