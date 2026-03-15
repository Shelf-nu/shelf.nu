import { vi } from "vitest";

/**
 * Reusable database mock patterns for testing services that use
 * Supabase query helpers (~/database/query-helpers.server).
 *
 * Services import query helpers like `create`, `findMany`, `update`, etc.
 * and pass the `db` client as the first argument. Tests should mock the
 * query-helpers module to intercept these calls.
 */

/**
 * Creates a complete set of mocked query helper functions.
 * Use with `vitest.mock("~/database/query-helpers.server", ...)`.
 *
 * Example:
 * ```ts
 * import { createQueryHelperMocks } from "@mocks/database";
 *
 * const mocks = createQueryHelperMocks();
 *
 * vitest.mock("~/database/query-helpers.server", () => mocks);
 * ```
 */
// why: testing service logic without executing actual database operations
export const createQueryHelperMocks = () => ({
  findMany: vi.fn().mockResolvedValue([]),
  findFirst: vi.fn().mockResolvedValue(null),
  findFirstOrThrow: vi.fn().mockResolvedValue({}),
  findUnique: vi.fn().mockResolvedValue(null),
  findUniqueOrThrow: vi.fn().mockResolvedValue({}),
  create: vi.fn().mockResolvedValue({}),
  createMany: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue([]),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  count: vi.fn().mockResolvedValue(0),
  upsert: vi.fn().mockResolvedValue({}),
  applyFilters: vi.fn((q: any) => q),
  applyOrderBy: vi.fn((q: any) => q),
  throwIfError: vi.fn((result: any) => result.data),
  throwIfNotFound: vi.fn((result: any) => result.data),
});

export type QueryHelperMocks = ReturnType<typeof createQueryHelperMocks>;
