import { vi } from "vitest";

/**
 * Mock implementation for the location descendants module.
 * Use this in your test files with vi.mock() at the top level:
 *
 * @example
 * vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);
 */
export const locationDescendantsMock = {
  getLocationDescendantIds: vi.fn(
    async ({ locationId }: { locationId: string }) => [locationId]
  ),
};
