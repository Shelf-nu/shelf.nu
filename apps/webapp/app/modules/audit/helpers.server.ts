import { findUnique, findMany, create } from "~/database/query-helpers.server";
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
  tx: any;
}) {
  const creator = await findUnique(tx, "User", {
    where: { id: createdById },
    select: "id, firstName, lastName",
  });

  if (!creator) {
    return; // Skip note creation if user not found
  }

  await create(tx, "AuditNote", {
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
  } as any);
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
  prefetchedUser,
  prefetchedAsset,
}: {
  auditSessionId: string;
  assetId: string;
  userId: string;
  isExpected: boolean;
  tx: any;
  prefetchedUser?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  prefetchedAsset?: { id: string; title: string } | null;
}) {
  // Use pre-fetched data if available, otherwise fetch
  const [asset, scanner] = await Promise.all([
    prefetchedAsset ??
      findUnique(tx, "Asset", {
        where: { id: assetId },
        select: "id, title",
      }),
    prefetchedUser ??
      findUnique(tx, "User", {
        where: { id: userId },
        select: "id, firstName, lastName",
      }),
  ]);

  if (!asset || !scanner) {
    return; // Skip note creation if asset or user not found
  }

  const assetStatus = isExpected ? "expected" : "unexpected";
  const assetLink = wrapAssetsWithDataForNote(asset, "scanned");

  await create(tx, "AuditNote", {
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
  } as any);
}

/**
 * Creates an automatic note when a scanned asset is removed from an audit.
 */
export async function createAssetScanRemovedNote({
  auditSessionId,
  assetId,
  userId,
  tx,
}: {
  auditSessionId: string;
  assetId: string;
  userId: string;
  tx: any;
}) {
  const [asset, remover] = await Promise.all([
    findUnique(tx, "Asset", {
      where: { id: assetId },
      select: "id, title",
    }),
    findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }),
  ]);

  if (!asset || !remover) {
    return; // Skip note creation if asset or user not found
  }

  const assetLink = wrapAssetsWithDataForNote(asset, "removed");

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: remover.id,
      type: "UPDATE",
      content: `${wrapUserLinkForNote({
        id: remover.id,
        firstName: remover.firstName,
        lastName: remover.lastName,
      })} removed scanned asset ${assetLink}.`,
    },
  } as any);
}

/**
 * Creates an automatic note when an audit is started (activated from PENDING status).
 * This note records who performed the first scan that activated the audit.
 */
export async function createAuditStartedNote({
  auditSessionId,
  userId,
  tx,
  prefetchedUser,
}: {
  auditSessionId: string;
  userId: string;
  tx: any;
  prefetchedUser?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
}) {
  // Use pre-fetched data if available, otherwise fetch
  const starter =
    prefetchedUser ??
    (await findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }));

  if (!starter) {
    return; // Skip note creation if user not found
  }

  await create(tx, "AuditNote", {
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
  } as any);
}

/**
 * Creates a COMMENT note when an audit is completed.
 * The note includes completion stats, receipt link, and any user-provided note/images.
 * Using COMMENT type for better layout (header with user info, content below without indentation).
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
  tx: any;
}) {
  const completer = await findUnique(tx, "User", {
    where: { id: userId },
    select: "id, firstName, lastName",
  });

  if (!completer) {
    return; // Skip note creation if user not found
  }

  // Calculate completion percentage
  const percentage =
    expectedCount > 0 ? Math.round((foundCount / expectedCount) * 100) : 0;

  // Build the note content starting with completion stats
  let content = `Audit completed. Found **${foundCount}/${expectedCount}** expected assets (**${percentage}%**), **${missingCount}** missing, **${unexpectedCount}** unexpected. [View receipt](/audits/${auditSessionId}/overview?receipt=1)`;

  // Append user's completion note if provided
  if (completionNote && completionNote.trim()) {
    content += `\n\n**Completion note:**\n\n> ${completionNote
      .trim()
      .replace(/\n/g, "\n> ")}`;
  }

  // Fetch and append audit images if any were uploaded during completion
  const auditImages = await findMany(tx, "AuditImage", {
    where: {
      auditSessionId,
      auditAssetId: null, // Only general audit images, not asset-specific
    },
    select: "id",
    orderBy: { createdAt: "asc" },
  });

  if (auditImages.length > 0) {
    const imageIds = auditImages.map((img: { id: string }) => img.id).join(",");
    content += `\n\n{% audit_images count=${auditImages.length} ids="${imageIds}" /%}`;
  }

  // Create a single COMMENT note for better layout
  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: completer.id,
      type: "COMMENT",
      content,
    },
  } as any);
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
  tx: any;
}) {
  const updater = await findUnique(tx, "User", {
    where: { id: userId },
    select: "id, firstName, lastName",
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

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: updater.id,
      type: "UPDATE",
      content,
    },
  } as any);
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
  tx: any;
}) {
  const [uploader, auditAsset] = await Promise.all([
    findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }),
    findUnique(tx, "AuditAsset", {
      where: { id: auditAssetId },
      select: "id, assetId",
    }),
  ]);

  if (!uploader || !auditAsset) {
    return; // Skip note creation if user or asset not found
  }

  // Fetch the asset details separately
  const asset = await findUnique(tx, "Asset", {
    where: { id: auditAsset.assetId },
    select: "id, title",
  });

  if (!asset) {
    return;
  }

  const imageCount = imageIds.length;
  const imageWord = imageCount === 1 ? "image" : "images";

  // Build content with image preview
  let content = `${wrapUserLinkForNote({
    id: uploader.id,
    firstName: uploader.firstName,
    lastName: uploader.lastName,
  })} added ${imageCount} ${imageWord} to ${wrapAssetsWithDataForNote(asset)}.`;

  // Add the audit_images tag for rendering
  const imageIdsStr = imageIds.join(",");
  content += `\n\n{% audit_images count=${imageCount} ids="${imageIdsStr}" /%}`;

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      auditAssetId, // Associate with specific asset
      userId: uploader.id,
      type: "UPDATE",
      content,
    },
  } as any);
}

/**
 * Creates an automatic note when the audit due date is changed.
 */
export async function createDueDateChangedNote({
  auditSessionId,
  userId,
  oldDate,
  newDate,
  tx,
}: {
  auditSessionId: string;
  userId: string;
  oldDate: Date | null;
  newDate: Date | null;
  tx: any;
}) {
  const updater = await findUnique(tx, "User", {
    where: { id: userId },
    select: "id, firstName, lastName",
  });

  if (!updater) {
    return; // Skip note creation if user not found
  }

  let content: string;

  if (!oldDate && newDate) {
    // Due date was set for the first time
    content = `${wrapUserLinkForNote({
      id: updater.id,
      firstName: updater.firstName,
      lastName: updater.lastName,
    })} set due date to **${newDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}**.`;
  } else if (oldDate && !newDate) {
    // Due date was cleared
    content = `${wrapUserLinkForNote({
      id: updater.id,
      firstName: updater.firstName,
      lastName: updater.lastName,
    })} cleared the due date.`;
  } else if (oldDate && newDate) {
    // Due date was changed
    content = `${wrapUserLinkForNote({
      id: updater.id,
      firstName: updater.firstName,
      lastName: updater.lastName,
    })} changed due date from **${oldDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}** to **${newDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}**.`;
  } else {
    return; // No change, skip note creation
  }

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: updater.id,
      type: "UPDATE",
      content,
    },
  } as any);
}

/**
 * Creates an automatic note when an assignee is added to an audit.
 */
export async function createAssigneeAddedNote({
  auditSessionId,
  userId,
  assigneeUserId,
  tx,
}: {
  auditSessionId: string;
  userId: string;
  assigneeUserId: string;
  tx: any;
}) {
  const [updater, assignee] = await Promise.all([
    findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }),
    findUnique(tx, "User", {
      where: { id: assigneeUserId },
      select: "id, firstName, lastName",
    }),
  ]);

  if (!updater || !assignee) {
    return; // Skip note creation if users not found
  }

  const content = `${wrapUserLinkForNote({
    id: updater.id,
    firstName: updater.firstName,
    lastName: updater.lastName,
  })} added assignee: ${wrapUserLinkForNote({
    id: assignee.id,
    firstName: assignee.firstName,
    lastName: assignee.lastName,
  })}.`;

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: updater.id,
      type: "UPDATE",
      content,
    },
  } as any);
}

/**
 * Creates an automatic note when an assignee is removed from an audit.
 */
export async function createAssigneeRemovedNote({
  auditSessionId,
  userId,
  assigneeUserId,
  tx,
}: {
  auditSessionId: string;
  userId: string;
  assigneeUserId: string;
  tx: any;
}) {
  const [updater, assignee] = await Promise.all([
    findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }),
    findUnique(tx, "User", {
      where: { id: assigneeUserId },
      select: "id, firstName, lastName",
    }),
  ]);

  if (!updater || !assignee) {
    return; // Skip note creation if users not found
  }

  const content = `${wrapUserLinkForNote({
    id: updater.id,
    firstName: updater.firstName,
    lastName: updater.lastName,
  })} removed assignee: ${wrapUserLinkForNote({
    id: assignee.id,
    firstName: assignee.firstName,
    lastName: assignee.lastName,
  })}.`;

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: updater.id,
      type: "UPDATE",
      content,
    },
  } as any);
}

/**
 * Creates an automatic note when assets are added to an existing audit.
 * Uses markdoc tags to show asset links/popovers.
 */
export async function createAssetsAddedToAuditNote({
  auditSessionId,
  userId,
  addedAssetIds,
  skippedCount,
  tx,
}: {
  auditSessionId: string;
  userId: string;
  addedAssetIds: string[];
  skippedCount: number;
  tx: any;
}) {
  const [adder, addedAssets] = await Promise.all([
    findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }),
    findMany(tx, "Asset", {
      where: { id: { in: addedAssetIds } },
      select: "id, title",
      orderBy: { title: "asc" },
    }),
  ]);

  if (!adder || addedAssets.length === 0) {
    return; // Skip note creation if user or assets not found
  }

  // Use wrapAssetsWithDataForNote to create proper asset links/popovers
  const assetsMarkdoc = wrapAssetsWithDataForNote(addedAssets, "added");

  let content = `${wrapUserLinkForNote({
    id: adder.id,
    firstName: adder.firstName,
    lastName: adder.lastName,
  })} added ${assetsMarkdoc} to audit.`;

  if (skippedCount > 0) {
    content += ` (**${skippedCount}** asset${
      skippedCount === 1 ? "" : "s"
    } skipped as already in audit)`;
  }

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: adder.id,
      type: "UPDATE",
      content,
    },
  } as any);
}

/**
 * Creates an automatic note when a single asset is removed from an audit.
 * Uses markdoc tags to show asset link.
 */
export async function createAssetRemovedFromAuditNote({
  auditSessionId,
  assetId,
  userId,
  tx,
}: {
  auditSessionId: string;
  assetId: string;
  userId: string;
  tx: any;
}) {
  const [remover, asset] = await Promise.all([
    findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }),
    findUnique(tx, "Asset", {
      where: { id: assetId },
      select: "id, title",
    }),
  ]);

  if (!remover || !asset) {
    return; // Skip note creation if user or asset not found
  }

  const assetMarkdoc = wrapAssetsWithDataForNote(asset, "removed");

  const content = `${wrapUserLinkForNote({
    id: remover.id,
    firstName: remover.firstName,
    lastName: remover.lastName,
  })} removed ${assetMarkdoc} from audit.`;

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: remover.id,
      type: "UPDATE",
      content,
    },
  } as any);
}

/**
 * Creates an automatic note when multiple assets are removed from an audit (bulk).
 * Uses markdoc tags to show asset links/popovers.
 */
export async function createAssetsRemovedFromAuditNote({
  auditSessionId,
  assetIds,
  userId,
  tx,
}: {
  auditSessionId: string;
  assetIds: string[];
  userId: string;
  tx: any;
}) {
  const [remover, assets] = await Promise.all([
    findUnique(tx, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    }),
    findMany(tx, "Asset", {
      where: { id: { in: assetIds } },
      select: "id, title",
      orderBy: { title: "asc" },
    }),
  ]);

  if (!remover || assets.length === 0) {
    return; // Skip note creation if user or assets not found
  }

  const assetsMarkdoc = wrapAssetsWithDataForNote(assets, "removed");

  const content = `${wrapUserLinkForNote({
    id: remover.id,
    firstName: remover.firstName,
    lastName: remover.lastName,
  })} removed ${assetsMarkdoc} from audit.`;

  await create(tx, "AuditNote", {
    data: {
      auditSessionId,
      userId: remover.id,
      type: "UPDATE",
      content,
    },
  } as any);
}
