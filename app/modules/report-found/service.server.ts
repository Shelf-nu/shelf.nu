import type { Item, ReportFound } from "@prisma/client";
import { db } from "~/database";

export async function createReport({
  email,
  content,
  itemId,
}: Pick<ReportFound, "email" | "content"> & { itemId: Item["id"] }) {
  return db.reportFound.create({
    data: {
      email,
      content,
      item: {
        connect: {
          id: itemId,
        },
      },
    },
  });
}
