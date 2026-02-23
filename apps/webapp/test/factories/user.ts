import type { User } from "@prisma/client";

/**
 * Factory for creating User test data
 */
export function createUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-123",
    email: "test@example.com",
    username: "testuser",
    firstName: "Test",
    lastName: "User",
    profilePicture: null,
    onboarded: true,
    createdAt: new Date("2023-01-01"),
    updatedAt: new Date("2023-01-01"),
    createdWithInvite: false,
    sso: false,
    customerId: null,
    roles: [],
    ...overrides,
  } as User;
}

/**
 * Common user IDs for consistent test data
 */
export const USER_ID = "59a13863-585b-57bf-8d90-2074f1817873";
export const USER_EMAIL = "hello@supabase.com";
