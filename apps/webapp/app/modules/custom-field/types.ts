import type { Sb } from "@shelf/database";

export type CustomFieldDraftPayload = Pick<
  Sb.CustomFieldRow,
  "helpText" | "name" | "type" | "required" | "active"
> & {
  organizationId: string;
  userId: string;
  options?: Sb.CustomFieldRow["options"];
  categories?: string[];
};
