/* eslint-disable no-console */
import type { User } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { ShelfError } from "~/utils/error";

const prisma = new PrismaClient();

async function seed() {
  try {
    const user = (await prisma.user.findFirst({
      where: {
        email: process.env.ADMIN_EMAIL,
      },
    })) as User;

    const org = await prisma.organization.findFirst({
      where: {
        userId: user.id,
      },
    });

    const times = 100;
    const assets = [];
    for (let i = 0; i < times; i++) {
      assets.push({
        title: `Asset ${i}`,
        description: `Asset ${i} description`,
        userId: user.id,
        organizationId: org!.id,
      });
    }

    await Promise.all(
      assets.map(async (asset) => {
        await prisma.asset.create({
          data: asset,
        });
      })
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Seed failed 🥲",
      label: "Unknown",
    });
  }
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
