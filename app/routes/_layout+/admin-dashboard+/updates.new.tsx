import { UpdateStatus, OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { MarkdownEditor } from "~/components/markdown/markdown-editor";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { createUpdate } from "~/modules/update/service.server";
import { makeShelfError } from "~/utils/error";
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

    const formData = await request.formData();

    // Handle role targeting
    const targetRoles: OrganizationRoles[] = [];
    if (formData.get("targetAdmin")) targetRoles.push(OrganizationRoles.ADMIN);
    if (formData.get("targetOwner")) targetRoles.push(OrganizationRoles.OWNER);
    if (formData.get("targetSelfService"))
      targetRoles.push(OrganizationRoles.SELF_SERVICE);
    if (formData.get("targetBase")) targetRoles.push(OrganizationRoles.BASE);

    const payload = parseData(
      formData,
      z.object({
        title: z.string().min(1, "Title is required"),
        content: z.string().min(1, "Content is required"),
        url: z.string().url("Must be a valid URL"),
        publishDate: z.string().transform((str) => new Date(str)),
        status: z.nativeEnum(UpdateStatus),
      })
    );

    await createUpdate({
      ...payload,
      targetRoles,
      createdById: userId,
    });

    return redirect("/admin-dashboard/updates");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
};

export default function NewUpdate() {
  // Default publish date to now
  const defaultPublishDate = new Date().toISOString().slice(0, 16);

  return (
    <Card>
      <h3 className="mb-6 text-lg font-semibold">Create New Update</h3>

      <Form method="post" className="flex flex-col gap-6">
        <Input
          label="Title"
          name="title"
          placeholder="Enter update title"
          required
        />

        <div>
          <label className="mb-[6px] block text-sm font-medium text-gray-700">
            Content
          </label>
          <MarkdownEditor
            defaultValue=""
            label="content"
            name="content"
            placeholder="Enter update content in Markdown format..."
            rows={6}
            className="rounded-b-none"
            required
          />
        </div>

        <Input
          label="URL"
          name="url"
          type="url"
          placeholder="https://example.com"
          required
        />

        <div>
          <label className="mb-[6px] block text-sm font-medium text-gray-700">
            Publish Date & Time
          </label>
          <Input
            label="Publish Date & Time"
            name="publishDate"
            type="datetime-local"
            defaultValue={defaultPublishDate}
            required
          />
        </div>

        <div>
          <label className="mb-3 block text-sm font-medium text-gray-700">
            Target Roles
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="targetAdmin" className="rounded" />
              <span className="text-sm">Admin</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="targetOwner" className="rounded" />
              <span className="text-sm">Owner</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="targetSelfService"
                className="rounded"
              />
              <span className="text-sm">Self Service</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="targetBase" className="rounded" />
              <span className="text-sm">Base</span>
            </label>
            <p className="text-xs text-gray-500">
              Leave all unchecked to make the update visible to all users
            </p>
          </div>
        </div>

        <div>
          <label className="mb-3 block text-sm font-medium text-gray-700">
            Status
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="status"
                value={UpdateStatus.DRAFT}
                defaultChecked
                className="rounded"
              />
              <span className="text-sm">Draft</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="status"
                value={UpdateStatus.PUBLISHED}
                className="rounded"
              />
              <span className="text-sm">Published</span>
            </label>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Draft updates are not visible to users until published
          </p>
        </div>

        <div className="flex gap-3">
          <Button type="submit" variant="primary">
            Create Update
          </Button>
          <Button to=".." variant="secondary">
            Cancel
          </Button>
        </div>
      </Form>
    </Card>
  );
}
