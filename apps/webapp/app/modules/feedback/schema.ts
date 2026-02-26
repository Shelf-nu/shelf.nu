import { z } from "zod";

export const feedbackSchema = z.object({
  type: z.enum(["issue", "idea"]),
  message: z
    .string()
    .min(10, "Please provide at least 10 characters")
    .max(5000, "Message is too long"),
});
