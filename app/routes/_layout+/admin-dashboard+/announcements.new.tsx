import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form } from "@remix-run/react";
import Input from "~/components/forms/input";
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
  const name = formData.get("name");
  const content = formData.get("content");
  const link = formData.get("link");
  const linkText = formData.get("linkText");

  console.log({ name, content, link, linkText });

  return null;
};

export default function NewAnnouncement() {
  return (
    <div>
      <Form method="post" className="flex flex-col gap-4">
        <Input label={"name"} name="name" />
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
            // ref={editorRef}
            className="rounded-b-none"
            // onBlur={handelBlur}
            // onKeyDown={handleKeyDown}
          />
        </div>
        <Input label={"Link"} name="link" />
        <Input label={"Link text"} name="linkText" />
        <Button type="submit">Save</Button>
      </Form>
    </div>
  );
}
