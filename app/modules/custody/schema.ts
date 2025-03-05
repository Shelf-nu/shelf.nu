import { z } from "zod";

// Base custodian shape that's common across different uses
const baseCustodianShape = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
});

export type BaseCustodianShape = z.infer<typeof baseCustodianShape>;

// Helper function to create a customized custodian schema
export const createCustodianSchema = (errorMessage?: string) =>
  z.string().transform((str, ctx): z.infer<typeof baseCustodianShape> => {
    try {
      const parsed = JSON.parse(str);

      // Validate the shape after parsing
      const result = baseCustodianShape.safeParse(parsed);

      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          message: errorMessage || "Please select a team member",
          path: [], // This will show the error at the root level
        });
        return z.NEVER;
      }

      return parsed;
    } catch (e) {
      ctx.addIssue({
        code: "custom",
        message: errorMessage || "Please select a team member",
        path: [], // This will show the error at the root level
      });
      return z.NEVER;
    }
  });

/** Used for assigning singular custody for kit or asset */
export const AssignCustodySchema = z.object({
  custodian: createCustodianSchema(),
});
