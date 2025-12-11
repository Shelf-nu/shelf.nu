import {
  wrapAssetsWithDataForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";

/**
 * Creates an automatic note when an audit is created.
 * This note records who created the audit and how many assets are expected.
 */
export async function createAuditCreationNote({
  auditSessionId,
  createdById,
  expectedAssetCount,
  tx,
}: {
  auditSessionId: string;
  createdById: string;
  expectedAssetCount: number;
  tx: any; // Prisma transaction client
}) {
  const creator = await tx.user.findUnique({
    where: { id: createdById },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!creator) {
    return; // Skip note creation if user not found
  }

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: creator.id,
      type: "UPDATE",
      content: `${wrapUserLinkForNote({
        id: creator.id,
        firstName: creator.firstName,
        lastName: creator.lastName,
      })} created this audit with **${expectedAssetCount}** expected asset${
        expectedAssetCount === 1 ? "" : "s"
      }.`,
    },
  });
}

/**
 * Creates an automatic note when an asset is scanned during an audit.
 * This note records who scanned the asset and whether it was expected or unexpected.
 */
export async function createAssetScanNote({
  auditSessionId,
  assetId,
  userId,
  isExpected,
  tx,
}: {
  auditSessionId: string;
  assetId: string;
  userId: string;
  isExpected: boolean;
  tx: any; // Prisma transaction client
}) {
  // Fetch asset and user details in parallel
  const [asset, scanner] = await Promise.all([
    tx.asset.findUnique({
      where: { id: assetId },
      select: { id: true, title: true },
    }),
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
  ]);

  if (!asset || !scanner) {
    return; // Skip note creation if asset or user not found
  }

  const assetStatus = isExpected ? "expected" : "unexpected";
  const assetLink = wrapAssetsWithDataForNote(asset, "scanned");

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: scanner.id,
      type: "UPDATE",
      content: `${wrapUserLinkForNote({
        id: scanner.id,
        firstName: scanner.firstName,
        lastName: scanner.lastName,
      })} scanned ${assetStatus} asset ${assetLink}.`,
    },
  });
}
