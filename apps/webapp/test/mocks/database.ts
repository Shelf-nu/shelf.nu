import { vi } from "vitest";

/**
 * Reusable database mock patterns for testing services that interact with Prisma.
 * Use these helpers to create consistent database mocks across tests.
 */

// why: testing service logic without actual database queries
export const createDbMock = <T extends Record<string, any>>(
  modelMethods: T
) => {
  const mockedMethods = Object.entries(modelMethods).reduce(
    (acc, [key, value]) => {
      acc[key] = typeof value === "function" ? value : vi.fn();
      return acc;
    },
    {} as Record<string, any>
  );

  return mockedMethods as { [K in keyof T]: ReturnType<typeof vi.fn> };
};

/**
 * Common Prisma method mocks
 */
export const createPrismaMethodMocks = () => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  createMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  count: vi.fn(),
  aggregate: vi.fn(),
  groupBy: vi.fn(),
  upsert: vi.fn(),
});

/**
 * Mock Prisma transaction
 * why: testing transactional logic without database
 */
export const createTransactionMock = () =>
  vi.fn().mockImplementation((callback) => {
    // Call the callback with a mock db instance
    return callback({});
  });
