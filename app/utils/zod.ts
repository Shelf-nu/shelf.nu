import { z, type ZodCustomIssue, type ZodIssue } from "zod";

type ZodCustomIssueWithMessage = ZodCustomIssue & { message: string };

export function createFormIssues(
  issues?: ZodIssue[]
): ZodCustomIssueWithMessage[] | undefined {
  return issues?.map(({ message, path }) => ({
    code: "custom",
    message,
    path,
  }));
}

export function zodFieldIsOptional(field: any) {
  return field instanceof z.ZodOptional;
}

export function zodFieldIsRequired(field: any) {
  return (
    !(field instanceof z.ZodOptional) &&
    !(field instanceof z.ZodNullable) &&
    field?._def?.checks?.length > 0
  );
}
