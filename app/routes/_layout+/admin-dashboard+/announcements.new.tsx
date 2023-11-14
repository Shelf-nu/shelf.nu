import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form } from "@remix-run/react";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { MarkdownEditor } from "~/components/markdown";
import { Button } from "~/components/shared";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAuthSession(request);
  await requireAdmin(request);

  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAuthSession(request);
  await requireAdmin(request);

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const content = formData.get("content") as string;
  const link = formData.get("link") as string;
  const linkText = formData.get("linkText") as string;
  const published = formData.get("published") === "on";

  await db.announcement.create({
    data: {
      name,
      content,
      link,
      linkText,
      published,
    },
  });

  return redirect("/admin-dashboard/announcements");
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
            label={"content"}
            name="content"
            placeholder={"Announcement content"}
            // @ts-ignore
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
            <Switch name={`published`} defaultChecked={false} required />
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
