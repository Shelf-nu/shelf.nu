import type { CustomField, Organization, User } from "@prisma/client";

export type CustomFieldDraftPayload = Pick<
  CustomField,
  "helpText" | "name" | "type" | "required" | "active"
> & {
  organizationId: Organization["id"];
  userId: User["id"];
  options?: CustomField["options"];
  categories?: string[];
};
