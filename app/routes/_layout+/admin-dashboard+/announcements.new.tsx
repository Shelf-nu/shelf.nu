import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { MarkdownEditor } from "~/components/markdown/markdown-editor";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
};

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const payload = parseData(
      await request.formData(),
      z.object({
        name: z.string(),
        content: z.string(),
        link: z.string(),
        linkText: z.string(),
        published: z.coerce.boolean(),
      })
    );

    await db.announcement
      .create({
        data: payload,
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to create announcement",
          additionalData: { userId, payload },
          label: "Admin dashboard",
        });
      });

    return redirect("/admin-dashboard/announcements");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
};

export default function NewAnnouncement() {
  return (
    <div>
      <Form method="post" className="flex flex-col gap-4">
        <Input label={"name"} name="name" required />
        <div>
          <label className="mb-[6px] text-text-sm font-medium text-gray-700">
            Announcement Content
          </label>
          <MarkdownEditor
            defaultValue=""
            label="content"
            name="content"
            placeholder={"Announcement content"}
            rows={4}
            className="rounded-b-none"
            required
          />
        </div>
        <Input label={"Link"} name="link" required />
        <Input label={"Link text"} name="linkText" required />
        <div className="">
          <label className="font-medium text-gray-700">
            <span>Published</span>
          </label>
          <div>
            <Switch name={`published`} defaultChecked={false} />
          </div>
        </div>
        <div className="flex gap-1">
          <Button type="submit">Save</Button>
          <Button to=".." variant="secondary">
            Cancel
          </Button>
        </div>
      </Form>
    </div>
  );
}
