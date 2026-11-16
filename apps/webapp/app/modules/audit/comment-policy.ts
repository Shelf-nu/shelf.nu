/**
 * Which audits accept comments.
 *
 * A finished audit — completed, cancelled or archived — is a record: its receipt
 * prints the condition notes it collected. A comment added afterwards would
 * appear in that receipt as though it were recorded during the audit, so only a
 * pending or active audit accepts new comments.
 *
 * Dependency-free so the server refusals and the note forms read the same rule.
 *
 * @see {@link file://./service.server.ts} assertAuditAcceptsComments — the server refusal
 */
import { AuditStatus } from "@prisma/client";

/** User-facing explanation shown wherever a comment is refused or hidden. */
export const AUDIT_CLOSED_TO_COMMENTS_MESSAGE =
  "This audit is finished and no longer accepts notes.";

/**
 * Whether an audit in this status still accepts new comments.
 *
 * @param status - The audit's current status
 * @returns `true` only for a pending or active audit
 */
export function auditAcceptsComments(status: AuditStatus): boolean {
  return status === AuditStatus.PENDING || status === AuditStatus.ACTIVE;
}
