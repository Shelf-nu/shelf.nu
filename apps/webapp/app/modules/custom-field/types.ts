import type { CustomField, Organization, User } from "@prisma/client";

export type CustomFieldDraftPayload = Pick<
  CustomField,
  "helpText" | "name" | "type" | "format" | "required" | "active"
> & {
  organizationId: Organization["id"];
  userId: User["id"];
  options?: CustomField["options"];
  categories?: string[];
};
