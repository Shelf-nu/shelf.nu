import type { ClientHint } from "~/utils/client-hints";
import type { AUDIT_SCHEDULER_EVENTS_ENUM } from "./constants";

export interface AuditSchedulerData {
  id: string;
  hints: ClientHint;
  eventType: AUDIT_SCHEDULER_EVENTS_ENUM;
}
