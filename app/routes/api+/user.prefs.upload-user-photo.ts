import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "react-router";
import sharp from "sharp";
import { requireAuthSession } from "~/modules/auth";
import { getUserByID, updateUser } from "~/modules/user";

import { assertIsPost, dateTimeInUnix } from "~/utils";
import {
  deleteProfilePicture,
  getPublicFileURL,
  parseFileFormData,
} from "~/utils/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  assertIsPost(request);
  const { userId } = await requireAuthSession(request);

  const user = await getUserByID(userId);

  /** needed for deleting */
  const previousProfilePictureUrl = user?.profilePicture || undefined;

  const formData = await parseFileFormData({
    request,
    newFileName: `${userId}/profile-${dateTimeInUnix(Date.now())}`,
    resizeOptions: {
      height: 150,
      width: 150,
      fit: sharp.fit.cover,
      withoutEnlargement: true,
    },
  });

  const profilePicture = formData.get("file") as string;

  /** if profile picture is an empty string, the upload failed so we return an error */
  if (!profilePicture || profilePicture === "") {
    return json(
      {
        error: "Something went wrong. Please refresh and try again",
      },
      { status: 500 }
    );
  }

  if (previousProfilePictureUrl) {
    /** Delete the old picture  */
    await deleteProfilePicture({ url: previousProfilePictureUrl });
  }
  /** Update user with new picture */
  const updatedUser = await updateUser({
    id: userId,
    profilePicture: getPublicFileURL({ filename: profilePicture }),
  });

  return json({ updatedUser });
};
