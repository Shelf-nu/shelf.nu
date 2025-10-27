import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import type { loader as loaderType } from "./locations.$locationId.activity";
import LocationActivity, { loader } from "./locations.$locationId.activity";

const requirePermissionMock = vi.hoisted(() => vi.fn());
const getLocationMock = vi.hoisted(() => vi.fn());
const getLocationNotesMock = vi.hoisted(() => vi.fn());

vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock("~/modules/location/service.server", () => ({
  getLocation: getLocationMock,
}));

vi.mock("~/modules/location-note/service.server", () => ({
  getLocationNotes: getLocationNotesMock,
  createLocationNote: vi.fn(),
  createSystemLocationNote: vi.fn(),
}));

vi.mock("~/components/location/notes", () => ({
  LocationNotes: () => <div data-testid="location-notes" />,
}));

const loaderDataMock = vi.hoisted(() => vi.fn());

vi.mock("@remix-run/react", async () => {
  const actual = await vi.importActual("@remix-run/react");
  return {
    ...actual,
    useLoaderData: loaderDataMock,
  };
});

vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({ roles: [] }),
}));

vi.mock("~/utils/permissions/permission.validator.client", () => ({
  userHasPermission: () => true,
}));

describe("locations.$locationId.activity route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaderDataMock.mockReset();
  });

  const createLoaderArgs = () => ({
    context: {
      getSession: () => ({ userId: "user-1" }),
    },
    request: new Request("https://example.com/locations/loc-1/activity"),
    params: { locationId: "loc-1" },
  });

  it("blocks access when the user lacks permission", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));

    await expect(
      loader(createLoaderArgs() as unknown as Parameters<typeof loaderType>[0])
    ).rejects.toMatchObject({ status: 500 });
  });

  it("returns location notes for authorized users", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [],
    });

    getLocationMock.mockResolvedValue({
      location: { id: "loc-1", name: "HQ" },
    });

    const note = {
      id: "lnote-1",
      content: "Checked HVAC",
      type: "COMMENT",
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { firstName: "Ada", lastName: "Lovelace" },
    };
    getLocationNotesMock.mockResolvedValue([note]);

    const response = await loader(
      createLoaderArgs() as unknown as Parameters<typeof loaderType>[0]
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.error).toBeNull();
    expect(body.location).toEqual({ id: "loc-1", name: "HQ" });
    expect(body.notes[0].id).toBe("lnote-1");
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.locationNote,
        action: PermissionAction.read,
      })
    );
  });

  it("renders the activity view", () => {
    loaderDataMock.mockReturnValue({
      location: { id: "loc-1", name: "HQ" },
      notes: [],
    });

    render(<LocationActivity />);

    expect(screen.getByTestId("location-notes")).toBeInTheDocument();
  });
});
