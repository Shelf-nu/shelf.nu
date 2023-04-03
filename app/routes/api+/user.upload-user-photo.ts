import type { ActionArgs } from "@remix-run/node";
import { json } from "react-router";
import { requireAuthSession } from "~/modules/auth";
import { getUserByID, updateUser } from "~/modules/user";

import { assertIsPost } from "~/utils";
import {
  deleteProfilePicture,
  parseFileFormData,
} from "~/utils/storage.server";

export const action = async ({ request }: ActionArgs) => {
  assertIsPost(request);
  const { userId } = await requireAuthSession(request);

  const user = await getUserByID(userId);
  /** needed for deleting */
  const previousProfilePictureUrl = user?.profilePicture || undefined;

  const formData = await parseFileFormData({
    request,
    newFileName: `${userId}/profile-${Math.floor(Date.now() / 1000)}`,
  });
  const profilePicture = formData.get("file") as string;

  /** if profile picture is an empty string, the upload failed so we return an error */
  if (profilePicture === "") {
    return json(
      {
        error: "Something went wrong. Please refresh and try again",
      },
      { status: 500 }
    );
  }

  /** Delete the old picture  */
  await deleteProfilePicture({ url: previousProfilePictureUrl || "" });
  /** Update user with new picture */
  const updatedUser = await updateUser({
    id: userId,
    profilePicture,
  });

  return json({ updatedUser });
};
