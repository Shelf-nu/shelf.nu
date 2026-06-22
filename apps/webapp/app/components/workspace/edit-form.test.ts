/**
 * Tests for the workspace SSO settings form schema.
 *
 * These lock in the security-relevant invariant that an SSO-enabled workspace
 * can never persist an empty group→role mapping: at least one of the three
 * group identifiers must be provided. The auth-side role resolver
 * (`getRoleFromGroupId`) treats an all-empty mapping as a hard deny, but the
 * schema is the first line of defence — it rejects the all-blank submission
 * server-side (the action parses with this same schema before saving).
 *
 * @see {@link file://./edit-form.tsx}
 * @see {@link file://./../../routes/_layout+/account-details.workspace.$workspaceId.edit.tsx}
 */
import { describe, expect, it } from "vitest";

import { EditWorkspaceSSOSettingsFormSchema } from "./edit-form";

describe("EditWorkspaceSSOSettingsFormSchema", () => {
  describe("when SSO is enabled", () => {
    const schema = EditWorkspaceSSOSettingsFormSchema(true);

    it("rejects a submission with no group mapped", () => {
      const result = schema.safeParse({
        id: "org-1",
        adminGroupId: "",
        selfServiceGroupId: "",
        baseUserGroupId: "",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // The "at least one group" error is surfaced on the Administrator field
        const issue = result.error.issues.find((i) =>
          i.path.includes("adminGroupId")
        );
        expect(issue?.message).toMatch(/at least one group/i);
      }
    });

    it("rejects a submission where every group is whitespace only", () => {
      const result = schema.safeParse({
        id: "org-1",
        adminGroupId: "   ",
        selfServiceGroupId: "\t",
        baseUserGroupId: " ",
      });

      expect(result.success).toBe(false);
    });

    it("accepts a submission with only one group mapped", () => {
      const result = schema.safeParse({
        id: "org-1",
        adminGroupId: "shelf-admins",
        selfServiceGroupId: "",
        baseUserGroupId: "",
      });

      expect(result.success).toBe(true);
    });

    it("accepts a submission with all three groups mapped", () => {
      const result = schema.safeParse({
        id: "org-1",
        adminGroupId: "shelf-admins",
        selfServiceGroupId: "shelf-self-service",
        baseUserGroupId: "shelf-base",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("when SSO is disabled", () => {
    const schema = EditWorkspaceSSOSettingsFormSchema(false);

    it("accepts a submission with no group mapped", () => {
      const result = schema.safeParse({
        id: "org-1",
        adminGroupId: "",
        selfServiceGroupId: "",
        baseUserGroupId: "",
      });

      expect(result.success).toBe(true);
    });
  });
});
