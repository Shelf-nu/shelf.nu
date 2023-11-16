import type { ZodType } from "zod";
import { z } from "zod";

type FormData = {
  name?: string;
  startDate?: Date;
  endDate?: Date;
  custodianId?: string; // This holds the ID of the custodian
};

//z.coerce.date() is used to convert the string to a date object.
export const BookingFormSchema: ZodType<FormData> = z
  .object({
    name: z.string().min(2, "Name is required"),
    startDate: z.coerce.date().refine((data) => data > new Date(), {
      message: "Start date must be in the future",
    }),
    endDate: z.coerce.date(),
    custodianId: z.string().min(1, "Custodian is required").cuid(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date cannot be earlier than start date.",
    path: ["endDate"],
  });

export function BookingForm({
  name,
  startDate,
  endDate,
  custodianId,
}: FormData) {
  return <div>BookingForm</div>;
}
