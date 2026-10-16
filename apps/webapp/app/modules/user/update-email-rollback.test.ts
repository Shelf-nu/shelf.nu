/**
 * Email changes across the auth account and the database.
 *
 * The address lives in two systems and sign-in needs them to agree: the auth
 * account resolves the session, and the user is then looked up in the database
 * by that same address. An account whose two records disagree cannot sign in to
 * either app, and no self-service path fixes it.
 *
 * Auth is written first, so the rollback after a failed database write is what
 * keeps the two in step. These tests pin that it is awaited and that a rollback
 * which itself fails is reported rather than dropped.
 *
 * @see {@link file://./service.server.ts} updateUserEmail
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

const { mockUpdateUserById } = vi.hoisted(() => ({
  mockUpdateUserById: vi.fn(),
}));
// why: the auth account is a remote service. Stubbing it lets each case choose
// which of the two auth writes fails — the change or the rollback after it,
// which is the distinction under test.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { updateUserById: mockUpdateUserById } },
  }),
}));

const { mockUserUpdate } = vi.hoisted(() => ({ mockUserUpdate: vi.fn() }));
// why: the database write is the one that fails in every rollback case, so the
// test drives it directly rather than through a database.
vi.mock("~/database/db.server", () => ({
  db: { user: { update: mockUserUpdate } },
}));

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));
// why: an unrepairable divergence can only be reported, so the report is the
// observable behaviour worth asserting.
vi.mock("~/utils/logger", () => ({
  Logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn() },
}));

import { updateUserEmail } from "./service.server";

const USER_ID = "user-1";
const CURRENT = "old@example.com";
const NEW = "new@example.com";

function changeEmail() {
  return updateUserEmail({
    userId: USER_ID,
    currentEmail: CURRENT,
    newEmail: NEW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateUserById.mockResolvedValue({ error: null });
  mockUserUpdate.mockResolvedValue({ id: USER_ID, email: NEW });
});

describe("updateUserEmail", () => {
  it("writes both systems on the happy path", async () => {
    await expect(changeEmail()).resolves.toEqual({
      id: USER_ID,
      email: NEW,
    });

    expect(mockUpdateUserById).toHaveBeenCalledTimes(1);
    expect(mockUpdateUserById).toHaveBeenCalledWith(USER_ID, { email: NEW });
  });

  it("restores the previous address when the database write fails", async () => {
    mockUserUpdate.mockRejectedValue(new Error("unique constraint"));

    await expect(changeEmail()).rejects.toThrow(ShelfError);

    // Auth was already carrying the new address; the second call puts it back.
    expect(mockUpdateUserById).toHaveBeenCalledTimes(2);
    expect(mockUpdateUserById).toHaveBeenLastCalledWith(USER_ID, {
      email: CURRENT,
    });
  });

  it("reports a rollback that fails instead of dropping it", async () => {
    mockUserUpdate.mockRejectedValue(new Error("unique constraint"));
    mockUpdateUserById
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("auth unavailable") });

    await expect(changeEmail()).rejects.toThrow(ShelfError);

    // The two systems now hold different addresses and nothing here can fix
    // it, so the report is what makes it repairable at all. Both addresses
    // have to be in it.
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const reported = mockLoggerError.mock.calls[0][0] as ShelfError;
    expect(reported.additionalData).toMatchObject({
      userId: USER_ID,
      currentEmail: CURRENT,
      newEmail: NEW,
    });
  });

  it("tells the user their address may be inconsistent", async () => {
    mockUserUpdate.mockRejectedValue(new Error("unique constraint"));
    mockUpdateUserById
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("auth unavailable") });

    // "Failed to update email in shelf" would read as "nothing happened",
    // which is the opposite of the truth.
    await expect(changeEmail()).rejects.toThrow(/contact support/i);
  });

  it("surfaces a rejected rollback rather than letting it go unhandled", async () => {
    // The rollback used to be fired without being awaited or caught, so a
    // rejection escaped the call entirely.
    mockUserUpdate.mockRejectedValue(new Error("unique constraint"));
    mockUpdateUserById
      .mockResolvedValueOnce({ error: null })
      .mockRejectedValueOnce(new Error("network down"));

    await expect(changeEmail()).rejects.toThrow(ShelfError);

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it("does not touch the database when the auth write is refused", async () => {
    mockUpdateUserById.mockResolvedValue({
      error: new Error("email already registered"),
    });

    await expect(changeEmail()).rejects.toThrow(ShelfError);

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
