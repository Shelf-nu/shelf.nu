import type { Asset, Kit, Note, Prisma, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  wrapKitsWithDataForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";

const label = "Note";

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
          assetName: asset.title,
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
  assetName,
  assetId,
  userId,
  isRemoving,
}: {
  currentKit: Pick<Kit, "id" | "name"> | null;
  newKit: Pick<Kit, "id" | "name"> | null;
  firstName: string;
  lastName: string;
  assetName: Asset["title"];
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
    const assetLink = wrapLinkForNote(`/assets/${assetId}`, assetName.trim());
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
      message = `${userLink} changed kit of ${assetLink} from ${currentKitLink} to ${newKitLink}.`;
    }

    /** User is adding asset to a kit for first time */
    if (newKit && !currentKit) {
      const newKitLink = wrapKitsWithDataForNote(
        { id: newKit.id, name: newKit.name.trim() },
        "added"
      );
      message = `${userLink} added ${assetLink} to ${newKitLink}.`;
    }

    /** User is removing the asset from kit */
    if (isRemoving && !newKit) {
      if (currentKit) {
        const currentKitLink = wrapKitsWithDataForNote(
          { id: currentKit.id, name: currentKit.name.trim() },
          "removed"
        );
        message = `${userLink} removed ${assetLink} from ${currentKitLink}.`;
      } else {
        message = `${userLink} removed ${assetLink} from a kit.`;
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
