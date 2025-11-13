import type { Prisma } from "@prisma/client";
import { type ActionFunctionArgs, data } from "react-router";
import sharp from "sharp";
import { getUserByID, updateUser } from "~/modules/user/service.server";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import { makeShelfError, ShelfError } from "~/utils/error";

import { assertIsPost, payload, error } from "~/utils/http.server";
import {
  deleteProfilePicture,
  getPublicFileURL,
  parseFileFormData,
} from "~/utils/storage.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const user = await getUserByID(userId, {
      select: { id: true, profilePicture: true } satisfies Prisma.UserSelect,
    });

    /** needed for deleting */
    const previousProfilePictureUrl = user.profilePicture;

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
      throw new ShelfError({
        cause: null,
        message: "Something went wrong. Please refresh and try again",
        label: "File storage",
      });
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

    return payload({ updatedUser });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
