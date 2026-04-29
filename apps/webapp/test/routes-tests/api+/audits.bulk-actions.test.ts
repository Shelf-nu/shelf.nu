/**
 * Route action tests for `/api/audits/bulk-actions`.
 *
 * These tests verify the wiring between the route action, the permission
 * layer, and the `bulkArchiveAudits` service — specifically:
 *   - HTTP method / intent validation short-circuit before any permission check
 *   - `PermissionAction.archive` is requested for the `bulk-archive` intent
 *   - `organizationId`, `userId`, `currentSearchParams`, and
 *     `isSelfServiceOrBase` are forwarded to the service
 *   - `ALL_SELECTED_KEY` sentinel values are passed through unchanged
 *   - Service + permission errors flow through `makeShelfError` and surface
 *     with the correct HTTP status on the response
 *
 * Lives under `test/routes-tests/` rather than next to the route itself
 * because React Router's flat-routes scanner auto-registers any `*.ts` /
 * `*.tsx` file inside `app/routes/` as a route module and would try to
 * serve this test file to the client — crashing the dev server on its
 * server-only imports.
 *
 * @see {@link file://../../../app/routes/api+/audits.bulk-actions.ts}
 * @see {@link file://../../../app/modules/audit/service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/api+/audits.bulk-actions";
import {
  bulkArchiveAudits,
  bulkDeleteAudits,
} from "~/modules/audit/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: mock the service functions so we can assert how the route wires arguments
vi.mock("~/modules/audit/service.server", () => ({
  bulkArchiveAudits: vi.fn(),
  bulkDeleteAudits: vi.fn(),
}));

// why: mock auth/permission layer so we can control the resolved org + role
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: notifications are a side-effect; stub to avoid touching emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the real `db.server` calls `db.$connect()` at module load outside of
// production, which fires a rejected Prisma connection in a test environment
// even when every consumer is mocked. Replacing the module with an empty
// client silences that unhandled rejection without affecting assertions —
// nothing in this test suite actually reads through `db`.
vi.mock("~/database/db.server", () => ({
  db: {},
}));

/**
 * Build a `Request` against the bulk-actions endpoint with a FormData body.
 *
 * Array values are appended with bracketed index keys (e.g. `auditIds[0]`,
 * `auditIds[1]`) to mirror how `BulkUpdateDialogContent` submits the form —
 * `parseFormAny` (used by `parseData`) reconstructs arrays from that shape.
 * A plain `.append(key, value)` twice would be coerced to the last value by
 * `setIn`, causing a schema mismatch against `z.array(z.string())`.
 */
function makeRequest(
  body: Record<string, string | string[]>,
  method: string = "POST"
): Request {
  const formData = new FormData();
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v)) {
      v.forEach((item, i) => formData.append(`${k}[${i}]`, item));
    } else {
      formData.append(k, v);
    }
  }

  // `GET`/`HEAD` requests can't carry a body; only attach formData for methods
  // that allow it so we can exercise the non-POST short-circuit branch.
  if (method === "GET" || method === "HEAD") {
    return new Request("http://test/api/audits/bulk-actions", { method });
  }
  return new Request("http://test/api/audits/bulk-actions", {
    method,
    body: formData,
  });
}

/**
 * Build a minimal `context` stub matching the surface used by the route —
 * only `getSession().userId` is read inside the action.
 */
function makeContext() {
  return {
    getSession: () => ({ userId: "user-1" }),
  } as any;
}

/** Build the full `ActionFunctionArgs` shape for the route handler. */
function callAction(request: Request) {
  return action({
    request,
    context: makeContext(),
    params: {},
  } as any);
}

describe("api/audits.bulk-actions action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-POST requests with 405 before any permission or service call", async () => {
    const response = (await callAction(makeRequest({}, "GET"))) as any;

    expect(response.init?.status).toBe(405);
    expect(bulkArchiveAudits).not.toHaveBeenCalled();
    expect(requirePermission).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent with a validation error response and does NOT call the service", async () => {
    const response = (await callAction(
      makeRequest({ intent: "wrong-intent", auditIds: ["a1"] })
    )) as any;

    expect(response.init?.status).toBeDefined();
    expect(response.init.status).not.toBe(200);
    expect(bulkArchiveAudits).not.toHaveBeenCalled();
  });

  it("requests `audit.archive` permission for the `bulk-archive` intent", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as any);
    vi.mocked(bulkArchiveAudits).mockResolvedValue(undefined as any);

    await callAction(makeRequest({ intent: "bulk-archive", auditIds: ["a1"] }));

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.audit,
        action: PermissionAction.archive,
        userId: "user-1",
      })
    );
  });

  it("forwards auditIds, organizationId, userId, currentSearchParams, and isSelfServiceOrBase to the service and emits a success notification", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as any);
    vi.mocked(bulkArchiveAudits).mockResolvedValue(undefined as any);

    const response = (await callAction(
      makeRequest({
        intent: "bulk-archive",
        auditIds: ["a1", "a2"],
        currentSearchParams: "status=COMPLETED",
      })
    )) as any;

    expect(bulkArchiveAudits).toHaveBeenCalledWith({
      auditIds: ["a1", "a2"],
      organizationId: "org-1",
      userId: "user-1",
      currentSearchParams: "status=COMPLETED",
      isSelfServiceOrBase: false,
    });
    expect(sendNotification).toHaveBeenCalledOnce();

    // The happy path returns `data(payload(...))` without an explicit status,
    // so `init` is null (no non-2xx status applied).
    const status = response.init?.status;
    expect(status === undefined || status === null || status === 200).toBe(
      true
    );
  });

  it("forwards the ALL_SELECTED_KEY sentinel unchanged to the service", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: true,
    } as any);
    vi.mocked(bulkArchiveAudits).mockResolvedValue(undefined as any);

    await callAction(
      makeRequest({
        intent: "bulk-archive",
        auditIds: [ALL_SELECTED_KEY],
        currentSearchParams: "status=COMPLETED",
      })
    );

    expect(bulkArchiveAudits).toHaveBeenCalledWith(
      expect.objectContaining({
        auditIds: [ALL_SELECTED_KEY],
        isSelfServiceOrBase: true,
        currentSearchParams: "status=COMPLETED",
      })
    );
  });

  it("surfaces a service ShelfError through the response with the matching status and message", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as any);
    vi.mocked(bulkArchiveAudits).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "Some audits are not in a completed or cancelled state and cannot be archived.",
        label: "Audit",
        status: 400,
      })
    );

    const response = (await callAction(
      makeRequest({ intent: "bulk-archive", auditIds: ["a1"] })
    )) as any;

    expect(response.init?.status).toBe(400);
    expect(response.data?.error?.message).toMatch(
      /not in a completed or cancelled state/
    );
    // Success notification must NOT fire when the service throws.
    expect(sendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Audits archived" })
    );
  });

  it("propagates a permission rejection as a non-200 response and does NOT call the service", async () => {
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Forbidden",
        label: "Auth",
        status: 403,
      })
    );

    const response = (await callAction(
      makeRequest({ intent: "bulk-archive", auditIds: ["a1"] })
    )) as any;

    expect(response.init?.status).toBe(403);
    expect(bulkArchiveAudits).not.toHaveBeenCalled();
  });

  describe("bulk-delete intent", () => {
    it("requests `audit.delete` permission for the `bulk-delete` intent", async () => {
      vi.mocked(requirePermission).mockResolvedValue({
        organizationId: "org-1",
        isSelfServiceOrBase: false,
      } as any);
      vi.mocked(bulkDeleteAudits).mockResolvedValue({ count: 1 } as any);

      await callAction(
        makeRequest({
          intent: "bulk-delete",
          auditIds: ["a1"],
          confirmation: "DELETE",
        })
      );

      expect(requirePermission).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: PermissionEntity.audit,
          action: PermissionAction.delete,
          userId: "user-1",
        })
      );
    });

    it("rejects when the confirmation word is missing or wrong", async () => {
      vi.mocked(requirePermission).mockResolvedValue({
        organizationId: "org-1",
        isSelfServiceOrBase: false,
      } as any);

      const response = (await callAction(
        makeRequest({
          intent: "bulk-delete",
          auditIds: ["a1"],
          confirmation: "delete", // wrong case — schema requires literal "DELETE"
        })
      )) as any;

      // Validation failure: non-2xx response and the service must not be called
      expect(response.init?.status).toBeDefined();
      expect(response.init.status).not.toBe(200);
      expect(bulkDeleteAudits).not.toHaveBeenCalled();
    });

    it("forwards auditIds + search params to the service and reports the deleted count in the notification", async () => {
      vi.mocked(requirePermission).mockResolvedValue({
        organizationId: "org-1",
        isSelfServiceOrBase: false,
      } as any);
      vi.mocked(bulkDeleteAudits).mockResolvedValue({ count: 3 } as any);

      await callAction(
        makeRequest({
          intent: "bulk-delete",
          auditIds: ["a1", "a2", "a3"],
          confirmation: "DELETE",
          currentSearchParams: "status=ARCHIVED",
        })
      );

      // isSelfServiceOrBase is intentionally NOT forwarded — delete is
      // ADMIN/OWNER-only, so plumbing the flag would be dead weight. Assert
      // the explicit shape so a future re-add is caught.
      expect(bulkDeleteAudits).toHaveBeenCalledWith({
        auditIds: ["a1", "a2", "a3"],
        organizationId: "org-1",
        userId: "user-1",
        currentSearchParams: "status=ARCHIVED",
      });
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Audits deleted",
          message: expect.stringMatching(/3 audits/),
        })
      );
    });

    it("uses singular 'audit' (title + message) in the notification when count is 1", async () => {
      vi.mocked(requirePermission).mockResolvedValue({
        organizationId: "org-1",
        isSelfServiceOrBase: false,
      } as any);
      vi.mocked(bulkDeleteAudits).mockResolvedValue({ count: 1 } as any);

      await callAction(
        makeRequest({
          intent: "bulk-delete",
          auditIds: ["a1"],
          confirmation: "DELETE",
        })
      );

      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Audit deleted",
          message: expect.stringMatching(/1 audit\./),
        })
      );
    });

    it("surfaces a service ShelfError with the matching HTTP status", async () => {
      vi.mocked(requirePermission).mockResolvedValue({
        organizationId: "org-1",
        isSelfServiceOrBase: false,
      } as any);
      vi.mocked(bulkDeleteAudits).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "Some selected audits are not archived.",
          label: "Audit",
          status: 409,
        })
      );

      const response = (await callAction(
        makeRequest({
          intent: "bulk-delete",
          auditIds: ["a1"],
          confirmation: "DELETE",
        })
      )) as any;

      expect(response.init?.status).toBe(409);
      expect(response.data?.error?.message).toMatch(/are not archived/);
      expect(sendNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "Audits deleted" })
      );
    });
  });
});
