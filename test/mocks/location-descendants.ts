import { vi } from "vitest";

export const mockLocationDescendants = () =>
  vi.mock("~/modules/location/descendants.server", () => ({
    getLocationDescendantIds: vi.fn(async ({ locationId }: { locationId: string }) => [locationId]),
  }));
