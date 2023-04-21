import { json, type ActionArgs } from "@remix-run/node";
import { parseFormAny } from "react-zorm";
import { NewNoteSchema } from "~/components/items/notes/new";
import { requireAuthSession } from "~/modules/auth";
import { createNote } from "~/modules/item";
import { assertIsPost } from "~/utils";

export const action = async ({ request, params }: ActionArgs) => {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);
  const formData = await request.formData();
  const result = await NewNoteSchema.safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      { status: 400 }
    );
  }

  return await createNote({
    ...result.data,
    userId: authSession.userId,
  });
};
