import type { ActionArgs } from "@remix-run/node";
import { json } from "react-router";
import { requireAuthSession } from "~/modules/auth";
import { updateUser } from "~/modules/user";

import { assertIsPost } from "~/utils";
import { parseFileFormData } from "~/utils/storage.server";

export const action = async ({ request }: ActionArgs) => {
  assertIsPost(request);
  const { userId } = await requireAuthSession(request);

  try {
    const formData = await parseFileFormData(request);
    const filename = formData.get("filename") as string;
    console.log("formData", formData);

    const updatedUser = await updateUser({
      id: userId,
      profilePicture: filename,
    });

    return json({ updatedUser });
  } catch (error) {
    return json({ error });
  }
};
