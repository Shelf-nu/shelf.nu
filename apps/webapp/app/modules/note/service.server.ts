import type {
  Asset,
  AuditSession,
  Category,
  Currency,
  Kit,
  Note,
  Prisma,
  Tag,
  User,
} from "@prisma/client";
import { db } from "~/database/db.server";
import {
  buildCategoryChangeNote,
  buildDescriptionChangeNote,
  buildNameChangeNote,
  buildValuationChangeNote,
  resolveUserLink,
} from "~/modules/note/helpers.server";
import type {
  BasicUserName,
  LoadUserForNotesFn,
} from "~/modules/note/load-user-for-notes.server";
export type { BasicUserName } from "~/modules/note/load-user-for-notes.server";
import { ShelfError } from "~/utils/error";
import {
  wrapKitsWithDataForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
  wrapTagForNote,
} from "~/utils/markdoc-wrappers";

const label = "Note";

export type TagSummary = Pick<Tag, "id" | "name">;

/** Creates a singular note */
export async function createNote({
  content,
  type,
  userId,
  assetId,
}: Pick<Note, "content"> & {
  type?: Note["type"];
  userId: User["id"];
  assetId: Asset["id"];
}) {
  try {
    const data = {
      content,
      type: type || "COMMENT",
      user: {
        connect: {
          id: userId,
        },
      },
      asset: {
        connect: {
          id: assetId,
        },
      },
    };

    return await db.note.create({
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a note",
      additionalData: { type, userId, assetId },
      label,
    });
  }
}

/** Creates multiple notes with the same content */
export async function createNotes({
  content,
  type,
  userId,
  assetIds,
}: Pick<Note, "content"> & {
  type?: Note["type"];
  userId: User["id"];
  assetIds: Asset["id"][];
}) {
  try {
    const data = assetIds.map((id) => ({
      content,
      type: type || "COMMENT",
      userId,
      assetId: id,
    }));

    return await db.note.createMany({
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating notes",
      additionalData: { type, userId, assetIds },
      label,
    });
  }
}

export async function deleteNote({
  id,
  userId,
}: Pick<Note, "id"> & { userId: User["id"] }) {
  try {
    return await db.note.deleteMany({
      where: { id, userId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the note",
      additionalData: { id, userId },
      label,
    });
  }
}

export async function createBulkKitChangeNotes({
  newlyAddedAssets,
  removedAssets,
  userId,
  kit,
}: {
  newlyAddedAssets: Prisma.AssetGetPayload<{
    select: { id: true; title: true; kit: true };
  }>[];
  removedAssets: Prisma.AssetGetPayload<{
    select: { id: true; title: true; kit: true };
  }>[];
  userId: User["id"];
  kit: Kit;
}) {
  try {
    const user = await db.user
      .findFirstOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "User not found",
          additionalData: { userId },
          label,
        });
      });

    for (const asset of [...newlyAddedAssets, ...removedAssets]) {
      const isAssetRemoved = removedAssets.some((a) => a.id === asset.id);
      const isNewlyAdded = newlyAddedAssets.some((a) => a.id === asset.id);
      const newKit = isAssetRemoved ? null : kit;
      const currentKit = asset.kit ? asset.kit : null;

      if (isNewlyAdded || isAssetRemoved) {
        await createKitChangeNote({
          currentKit,
          newKit,
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          assetId: asset.id,
          userId,
          isRemoving: isAssetRemoved,
        });
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating bulk kit change notes",
      additionalData: {
        userId,
        newlyAddedAssetsIds: newlyAddedAssets.map((a) => a.id),
        removedAssetsIds: removedAssets.map((a) => a.id),
      },
      label,
    });
  }
}

export async function createKitChangeNote({
  currentKit,
  newKit,
  firstName,
  lastName,
  assetId,
  userId,
  isRemoving,
}: {
  currentKit: Pick<Kit, "id" | "name"> | null;
  newKit: Pick<Kit, "id" | "name"> | null;
  firstName: string;
  lastName: string;
  assetId: Asset["id"];
  userId: User["id"];
  isRemoving: boolean;
}) {
  try {
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName,
      lastName,
    });
    let message = "";

    /** User is changing from kit to another */
    if (currentKit && newKit && currentKit.id !== newKit.id) {
      const currentKitLink = wrapKitsWithDataForNote(
        { id: currentKit.id, name: currentKit.name.trim() },
        "updated"
      );
      const newKitLink = wrapKitsWithDataForNote(
        { id: newKit.id, name: newKit.name.trim() },
        "updated"
      );
      message = `${userLink} changed kit  from ${currentKitLink} to ${newKitLink}.`;
    }

    /** User is adding asset to a kit for first time */
    if (newKit && !currentKit) {
      const newKitLink = wrapKitsWithDataForNote(
        { id: newKit.id, name: newKit.name.trim() },
        "added"
      );
      message = `${userLink} added asset to ${newKitLink}.`;
    }

    /** User is removing the asset from kit */
    if (isRemoving && !newKit) {
      if (currentKit) {
        const currentKitLink = wrapKitsWithDataForNote(
          { id: currentKit.id, name: currentKit.name.trim() },
          "removed"
        );
        message = `${userLink} removed asset from ${currentKitLink}.`;
      } else {
        message = `${userLink} removed asset from a kit.`;
      }
    }

    if (!message) {
      return;
    }

    await createNote({
      content: message,
      type: "UPDATE",
      userId,
      assetId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a kit change note. Please try again or contact support",
      additionalData: { userId, assetId },
      label,
    });
  }
}

export async function createTagChangeNoteIfNeeded({
  assetId,
  userId,
  previousTags,
  currentTags,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  previousTags: TagSummary[];
  currentTags: TagSummary[];
  loadUserForNotes: () => Promise<BasicUserName>;
}) {
  const previousTagIds = new Set(previousTags.map((tag) => tag.id));
  const currentTagIds = new Set(currentTags.map((tag) => tag.id));

  const addedTags = currentTags.filter((tag) => !previousTagIds.has(tag.id));
  const removedTags = previousTags.filter((tag) => !currentTagIds.has(tag.id));

  if (addedTags.length === 0 && removedTags.length === 0) {
    return;
  }

  const user = await loadUserForNotes();
  const userLink = wrapUserLinkForNote({
    id: userId,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  });

  const formatTagNames = (tagList: TagSummary[]) =>
    tagList
      .map((tag) =>
        wrapTagForNote({
          id: tag.id,
          name: (tag.name ?? "Unnamed tag").trim(),
        })
      )
      .join(tagList.length > 1 ? ", " : "");

  const actions: string[] = [];

  if (addedTags.length > 0) {
    actions.push(
      `added tag${addedTags.length > 1 ? "s" : ""} ${formatTagNames(addedTags)}`
    );
  }

  if (removedTags.length > 0) {
    actions.push(
      `removed tag${removedTags.length > 1 ? "s" : ""} ${formatTagNames(
        removedTags
      )}`
    );
  }

  if (actions.length === 0) {
    return;
  }

  const content = `${userLink} ${actions.join(" and ")}.`;

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
  });
}

/**
 * Persist a note capturing asset name changes using the text diff helper.
 */
export async function createAssetNameChangeNote({
  assetId,
  userId,
  previousName,
  newName,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  previousName?: string | null;
  newName?: string | null;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildNameChangeNote({
    userLink,
    previous: previousName,
    next: newName,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
  });
}

/**
 * Persist a note describing updates to the asset description.
 */
export async function createAssetDescriptionChangeNote({
  assetId,
  userId,
  previousDescription,
  newDescription,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  previousDescription?: string | null;
  newDescription?: string | null;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildDescriptionChangeNote({
    userLink,
    previous: previousDescription,
    next: newDescription,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
  });
}

/**
 * Persist a note when the asset category is added, changed, or removed.
 */
export async function createAssetCategoryChangeNote({
  assetId,
  userId,
  previousCategory,
  newCategory,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  previousCategory?: Pick<Category, "id" | "name" | "color"> | null;
  newCategory?: Pick<Category, "id" | "name" | "color"> | null;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildCategoryChangeNote({
    userLink,
    previous: previousCategory,
    next: newCategory,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
  });
}

/**
 * Persist a note highlighting valuation adjustments with formatted currency values.
 */
export async function createAssetValuationChangeNote({
  assetId,
  userId,
  previousValuation,
  newValuation,
  currency,
  locale,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  previousValuation?: Prisma.Decimal | number | null;
  newValuation?: Prisma.Decimal | number | null;
  currency: Currency;
  locale: string;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildValuationChangeNote({
    userLink,
    previous: previousValuation,
    next: newValuation,
    currency,
    locale,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
  });
}

/**
 * Create asset notes when assets are added to an audit
 */
export async function createAssetNotesForAuditAddition({
  assetIds,
  userId,
  audit,
}: {
  assetIds: Asset["id"][];
  userId: User["id"];
  audit: Pick<AuditSession, "id" | "name">;
}) {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!user || assetIds.length === 0) return;

    const userLink = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
    });

    const auditLink = wrapLinkForNote(
      `/audits/${audit.id}/overview`,
      audit.name
    );

    const content = `${userLink} added asset to audit ${auditLink}.`;

    await createNotes({
      content,
      type: "UPDATE",
      userId,
      assetIds,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating asset notes for audit addition",
      additionalData: { userId, assetIds, auditId: audit.id },
      label,
    });
  }
}

/**
 * Create asset notes when assets are removed from an audit
 */
export async function createAssetNotesForAuditRemoval({
  assetIds,
  userId,
  audit,
}: {
  assetIds: Asset["id"][];
  userId: User["id"];
  audit: Pick<AuditSession, "id" | "name">;
}) {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!user || assetIds.length === 0) return;

    const userLink = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
    });

    const auditLink = wrapLinkForNote(
      `/audits/${audit.id}/overview`,
      audit.name
    );

    const content = `${userLink} removed asset from audit ${auditLink}.`;

    await createNotes({
      content,
      type: "UPDATE",
      userId,
      assetIds,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating asset notes for audit removal",
      additionalData: { userId, assetIds, auditId: audit.id },
      label,
    });
  }
}
