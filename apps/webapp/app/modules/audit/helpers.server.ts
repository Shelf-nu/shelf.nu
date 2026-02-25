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
  tx: any; // Prisma transaction client
}) {
  const [asset, remover] = await Promise.all([
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

  if (!asset || !remover) {
    return; // Skip note creation if asset or user not found
  }

  const assetLink = wrapAssetsWithDataForNote(asset, "removed");

  await tx.auditNote.create({
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

  // Build the note content starting with completion stats
  let content = `Audit completed. Found **${foundCount}/${expectedCount}** expected assets (**${percentage}%**), **${missingCount}** missing, **${unexpectedCount}** unexpected. [View receipt](/audits/${auditSessionId}/overview?receipt=1)`;

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

  // Create a single COMMENT note for better layout
  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: completer.id,
      type: "COMMENT",
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
  tx: any; // Prisma transaction client
}) {
  const [updater, assignee] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
    tx.user.findUnique({
      where: { id: assigneeUserId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
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
  tx: any; // Prisma transaction client
}) {
  const [updater, assignee] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
    tx.user.findUnique({
      where: { id: assigneeUserId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
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
  tx: any; // Prisma transaction client
}) {
  const [adder, addedAssets] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
    tx.asset.findMany({
      where: { id: { in: addedAssetIds } },
      select: { id: true, title: true },
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

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: adder.id,
      type: "UPDATE",
      content,
    },
  });
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
  tx: any; // Prisma transaction client
}) {
  const [remover, asset] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
    tx.asset.findUnique({
      where: { id: assetId },
      select: { id: true, title: true },
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

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: remover.id,
      type: "UPDATE",
      content,
    },
  });
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
  tx: any; // Prisma transaction client
}) {
  const [remover, assets] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    }),
    tx.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, title: true },
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

  await tx.auditNote.create({
    data: {
      auditSessionId,
      userId: remover.id,
      type: "UPDATE",
      content,
    },
  });
}
