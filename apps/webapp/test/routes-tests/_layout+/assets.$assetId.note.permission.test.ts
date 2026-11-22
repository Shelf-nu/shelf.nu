// @vitest-environment node
/**
 * Asset notes are gated on the note permissions, not on editing the asset:
 * adding needs note:create, deleting needs note:delete (and only ever removes
 * the caller's own note, because `deleteNote` scopes to the author).
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.note.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import { createNote, deleteNote } from "~/modules/note/service.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: only the gate is under test, so it is observed rather than executed
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: the asset's organization check is a database read outside this test
vi.mock("~/database/db.server", () => ({
  db: { asset: { findUnique: vi.fn(async () => ({ id: "asset-1" })) } },
}));

// why: note writes are tested with their service
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(async () => ({ id: "note-1" })),
  deleteNote: vi.fn(async () => ({ count: 1 })),
}));

// why: toasts go through the notification emitter, which is not under test
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const { action } = await import("~/routes/_layout+/assets.$assetId.note");

/**
 * Submits the note form with `method` and `body`.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function send(method: "POST" | "DELETE", body: Record<string, string>) {
  return action(
    createActionArgs({
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/assets/asset-1/note", {
        method,
        body: new URLSearchParams(body),
      }),
    })
  );
}

describe("asset note action gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adding a note requires note:create", async () => {
    await send("POST", { content: "hello there" });

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.note,
        action: PermissionAction.create,
      })
    );
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", organizationId: "org-1" })
    );
  });

  it("deleting a note requires note:delete and scopes to the caller", async () => {
    await send("DELETE", { noteId: "note-1" });

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.note,
        action: PermissionAction.delete,
      })
    );
    expect(deleteNote).toHaveBeenCalledWith({
      id: "note-1",
      userId: "user-1",
      organizationId: "org-1",
    });
  });
});
