/**
 * Who may have PDF templates: team workspaces only, whatever the premium
 * features switch says.
 *
 * @see {@link file://./access.ts}
 */
import { OrganizationType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ShelfError } from "~/utils/error";
import { assertCanUsePdfTemplates, canUsePdfTemplates } from "./access";

describe("canUsePdfTemplates", () => {
  it("allows a team workspace", () => {
    expect(canUsePdfTemplates({ type: OrganizationType.TEAM })).toBe(true);
  });

  it("refuses a personal workspace", () => {
    expect(canUsePdfTemplates({ type: OrganizationType.PERSONAL })).toBe(false);
  });
});

describe("assertCanUsePdfTemplates", () => {
  it("passes a team workspace", () => {
    expect(() =>
      assertCanUsePdfTemplates({ type: OrganizationType.TEAM })
    ).not.toThrow();
  });

  it("refuses a personal workspace with a 403 that is not reported", () => {
    let thrown: unknown;
    try {
      assertCanUsePdfTemplates({ type: OrganizationType.PERSONAL });
    } catch (cause) {
      thrown = cause;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    expect(thrown).toMatchObject({ status: 403, shouldBeCaptured: false });
  });
});
