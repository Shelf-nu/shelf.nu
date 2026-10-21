/**
 * Editing a custom-field definition.
 *
 * A field's type is immutable once it exists, so this action deliberately ignores
 * the submitted `type`. That makes the submitted value the wrong thing to judge
 * the "an OPTION field needs options" rule against: the schema can only see what
 * was posted, so the action has to re-check against the type the field actually
 * has.
 *
 * @see {@link file://./../../../app/routes/_layout+/settings.custom-fields.$fieldId_.edit.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";

import {
  getCustomField,
  updateCustomField,
} from "~/modules/custom-field/service.server";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/_layout+/settings.custom-fields.$fieldId_.edit";

// @vitest-environment node

// why: the route imports the real Prisma client transitively; every read and
// write it makes goes through the service stubbed below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the permission check reads the session cookie and the database.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: `getCustomField` supplies the persisted type this case turns on, and
// `updateCustomField` is the write that must not happen.
vi.mock("~/modules/custom-field/service.server", () => ({
  getCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  assertUserCanCreateMoreCustomFields: vi.fn(),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

async function submit(fields: Record<string, string>) {
  const response = await action(
    createActionArgs({
      request: new Request(
        "http://localhost/settings/custom-fields/cf-1/edit",
        {
          method: "POST",
          body: new URLSearchParams({
            name: "Size",
            organizationId: "org-1",
            ...fields,
          }),
        }
      ),
      params: { fieldId: "cf-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );

  return response;
}

describe("edit custom field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      organizations: [{ id: "org-1" }],
    } as never);
    // The field as it exists in the database: an OPTION field.
    vi.mocked(getCustomField).mockResolvedValue({
      id: "cf-1",
      type: "OPTION",
      active: true,
      options: ["Large"],
    } as never);
  });

  it("refuses to leave a persisted OPTION field without options, even when the submitted type says otherwise", async () => {
    // A crafted post: the submitted type is ignored by this action, so claiming
    // TEXT would slip past a rule that only reads what was submitted.
    const response = await submit({ type: "TEXT" });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(updateCustomField).not.toHaveBeenCalled();
  });

  it("refuses an OPTION field submitted with no options", async () => {
    const response = await submit({ type: "OPTION" });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(updateCustomField).not.toHaveBeenCalled();
  });

  it("saves when a selectable option is present", async () => {
    await submit({ type: "OPTION", "options[0]": "Large" });

    expect(updateCustomField).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cf-1", options: ["Large"] })
    );
  });

  it("does not apply the rule to a persisted non-OPTION field", async () => {
    vi.mocked(getCustomField).mockResolvedValue({
      id: "cf-1",
      type: "TEXT",
      active: true,
      options: [],
    } as never);

    await submit({ type: "TEXT" });

    expect(updateCustomField).toHaveBeenCalled();
  });
});
