import { json, type ActionArgs } from "@remix-run/node";
import { parseFormAny } from "react-zorm";
import { NewNoteSchema } from "~/components/items/notes/new";
import { requireAuthSession } from "~/modules/auth";
import { createNote, deleteNote } from "~/modules/item";
import { assertIsDelete, assertIsPost, isDelete, isPost } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export const action = async ({ request, params }: ActionArgs) => {
  const authSession = await requireAuthSession(request);
  const formData = await request.formData();

  /* Create note */
  if (isPost(request)) {
    assertIsPost(request);
    const result = await NewNoteSchema.safeParseAsync(parseFormAny(formData));

    if (!result.success) {
      return json(
        {
          errors: result.error,
        },
        { status: 400 }
      );
    }

    if (!params.itemId)
      return json({ errors: "itemId is required" }, { status: 400 });

    sendNotification({
      title: "Note created",
      message: "Your note has been created successfully",
      icon: { name: "success", variant: "success" },
    });
    return await createNote({
      ...result.data,
      itemId: params.itemId,
      userId: authSession.userId,
    });
  }

  /* Delete note */
  if (isDelete(request)) {
    assertIsDelete(request);
    const noteId = formData.get("noteId") as string | null;
    if (!noteId) return json({ errors: "noteId is required" }, { status: 400 });

    sendNotification({
      title: "Note deleted",
      message: "Your note has been deleted successfully",
      icon: { name: "trash", variant: "error" },
    });
    return await deleteNote({
      id: noteId,
      userId: authSession.userId,
    });
  }
};
