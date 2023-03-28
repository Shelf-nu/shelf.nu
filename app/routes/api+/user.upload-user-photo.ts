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

  try {
    const user = await getUserByID(userId);
    /** needed for deleting */
    const previousProfilePictureUrl = user?.profilePicture || undefined;

    const formData = await parseFileFormData(request);
    const profilePicture = formData.get("file") as string;

    /** Delete the old picture */
    await deleteProfilePicture({ url: previousProfilePictureUrl || "" });

    /** Update user with new picture */
    const updatedUser = await updateUser({
      id: userId,
      profilePicture,
    });

    return json({ updatedUser });
  } catch (error) {
    return json({ error });
  }
};
