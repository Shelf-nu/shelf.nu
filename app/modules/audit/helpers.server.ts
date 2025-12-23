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
      })} created audit with **${expectedAssetCount}** expected asset${
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

/**
 * Creates an automatic note when an audit is started (activated from PENDING status).
 * This note records who performed the first scan that activated the audit.
 */
export async function createAuditStartedNote({
  auditSessionId,
  userId,
  tx,
}: {
  auditSessionId: string;
  userId: string;
  tx: any; // Prisma transaction client
}) {
  const starter = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!starter) {
    return; // Skip note creation if user not found
  }

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: starter.id,
      type: "UPDATE",
      content: `${wrapUserLinkForNote({
        id: starter.id,
        firstName: starter.firstName,
        lastName: starter.lastName,
      })} started the audit.`,
    },
  });
}

/**
 * Creates an automatic note when an audit is completed.
 * This note records who completed the audit, shows statistics, and includes
 * the optional completion message provided by the user.
 */
export async function createAuditCompletedNote({
  auditSessionId,
  userId,
  expectedCount,
  foundCount,
  missingCount,
  unexpectedCount,
  completionNote,
  tx,
}: {
  auditSessionId: string;
  userId: string;
  expectedCount: number;
  foundCount: number;
  missingCount: number;
  unexpectedCount: number;
  completionNote?: string | null;
  tx: any; // Prisma transaction client
}) {
  const completer = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!completer) {
    return; // Skip note creation if user not found
  }

  // Calculate completion percentage
  const percentage =
    expectedCount > 0 ? Math.round((foundCount / expectedCount) * 100) : 0;

  // Build the note content
  let content = `${wrapUserLinkForNote({
    id: completer.id,
    firstName: completer.firstName,
    lastName: completer.lastName,
  })} completed the audit. Found **${foundCount}/${expectedCount}** expected assets (**${percentage}%**), **${missingCount}** missing, **${unexpectedCount}** unexpected.`;

  // Append user's completion note if provided
  if (completionNote && completionNote.trim()) {
    content += `\n\n**Completion note:**\n\n> ${completionNote
      .trim()
      .replace(/\n/g, "\n> ")}`;
  }

  // Fetch and append audit images if any were uploaded during completion
  const auditImages = await tx.auditImage.findMany({
    where: {
      auditSessionId,
      auditAssetId: null, // Only general audit images, not asset-specific
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (auditImages.length > 0) {
    const imageIds = auditImages.map((img: { id: string }) => img.id).join(",");
    content += `\n\n{% audit_images count=${auditImages.length} ids="${imageIds}" /%}`;
  }

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: completer.id,
      type: "UPDATE",
      content,
    },
  });
}

/**
 * Creates an automatic note when audit details are updated.
 * Tracks changes to name and/or description.
 */
export async function createAuditUpdateNote({
  auditSessionId,
  userId,
  changes,
  tx,
}: {
  auditSessionId: string;
  userId: string;
  changes: Array<{ field: string; from: string; to: string }>;
  tx: any; // Prisma transaction client
}) {
  const updater = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!updater || changes.length === 0) {
    return; // Skip note creation if user not found or no changes
  }

  // Build the content describing the changes
  const changeDescriptions = changes.map((change) => {
    const fieldLabel = change.field === "name" ? "audit name" : change.field;
    return `- **${fieldLabel}**: "${change.from}" → "${change.to}"`;
  });

  const content = `${wrapUserLinkForNote({
    id: updater.id,
    firstName: updater.firstName,
    lastName: updater.lastName,
  })} updated audit details:\n\n${changeDescriptions.join("\n\n")}`;

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: updater.id,
      type: "UPDATE",
      content,
    },
  });
}

/**
 * Creates an automatic note when images are added to a specific audit asset.
 * This note includes an embedded preview of the uploaded images.
 */
export async function createAuditAssetImagesAddedNote({
  auditSessionId,
  auditAssetId,
  userId,
  imageIds,
  tx,
}: {
  auditSessionId: string;
  auditAssetId: string;
  userId: string;
  imageIds: string[];
  tx: any; // Prisma transaction client
}) {
  const [uploader, asset] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
    tx.auditAsset.findUnique({
      where: { id: auditAssetId },
      include: {
        asset: {
          select: { id: true, title: true },
        },
      },
    }),
  ]);

  if (!uploader || !asset) {
    return; // Skip note creation if user or asset not found
  }

  const imageCount = imageIds.length;
  const imageWord = imageCount === 1 ? "image" : "images";

  // Build content with image preview
  let content = `${wrapUserLinkForNote({
    id: uploader.id,
    firstName: uploader.firstName,
    lastName: uploader.lastName,
  })} added ${imageCount} ${imageWord} to ${wrapAssetsWithDataForNote(
    asset.asset
  )}.`;

  // Add the audit_images tag for rendering
  const imageIdsStr = imageIds.join(",");
  content += `\n\n{% audit_images count=${imageCount} ids="${imageIdsStr}" /%}`;

  await tx.auditNote.create({
    data: {
      auditSessionId,
      auditAssetId, // Associate with specific asset
      userId: uploader.id,
      type: "UPDATE",
      content,
    },
  });
}
