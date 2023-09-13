/* eslint-disable no-console */
import { PrismaClient, TierId } from "@prisma/client";

const prisma = new PrismaClient();

export async function createTiers() {
  return await prisma.tier.createMany({
    data: [
      { id: TierId.free, name: "Free" },
      { id: TierId.tier_1, name: "Plus" },
      { id: TierId.tier_2, name: "Team" },
    ],
  });
}
