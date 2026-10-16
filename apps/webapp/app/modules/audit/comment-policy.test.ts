/**
 * Which audits accept comments.
 *
 * @see {@link file://./comment-policy.ts}
 */
import { AuditStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { auditAcceptsComments } from "./comment-policy";

describe("auditAcceptsComments", () => {
  it.each([AuditStatus.PENDING, AuditStatus.ACTIVE])(
    "accepts comments on a %s audit",
    (status) => {
      expect(auditAcceptsComments(status)).toBe(true);
    }
  );

  it.each([AuditStatus.COMPLETED, AuditStatus.CANCELLED, AuditStatus.ARCHIVED])(
    "refuses comments on a %s audit, which is already a record",
    (status) => {
      expect(auditAcceptsComments(status)).toBe(false);
    }
  );
});
