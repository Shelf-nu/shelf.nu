import { UpdateStatus, OrganizationRoles } from "@prisma/client";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { MarkdownEditor } from "~/components/markdown/markdown-editor";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";

interface UpdateFormProps {
  id?: string;
  title?: string;
  content?: string;
  url?: string | null;
  publishDate?: Date;
  status?: UpdateStatus;
  targetRoles?: OrganizationRoles[];
}

export function UpdateForm({
  id,
  title = "",
  content = "",
  url = null,
  publishDate,
  status = UpdateStatus.DRAFT,
  targetRoles = [],
}: UpdateFormProps) {
  // Default publish date to now if not provided
  const defaultPublishDate = publishDate
    ? new Date(publishDate).toISOString().slice(0, 16)
    : new Date().toISOString().slice(0, 16);

  const isEdit = !!id;
  const disabled = useDisabled();

  return (
    <Form method="post" className="flex flex-col gap-6">
      <Input
        label="Title"
        name="title"
        defaultValue={title}
        placeholder="Enter update title"
        required
      />

      <div>
        <label className="mb-[6px] block text-sm font-medium text-gray-700">
          Content
        </label>
        <MarkdownEditor
          defaultValue={content}
          label="content"
          name="content"
          placeholder="Enter update content in Markdown format..."
          rows={6}
          className="rounded-b-none"
          required
        />
      </div>

      <Input
        label="URL (optional)"
        name="url"
        type="url"
        defaultValue={url || ""}
        placeholder="https://example.com (leave empty for updates without links)"
      />

      <div>
        <label className="mb-[6px] block text-sm font-medium text-gray-700">
          Publish Date & Time
        </label>
        <Input
          label="Publish Date"
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
            <input
              type="checkbox"
              name="targetAdmin"
              defaultChecked={targetRoles.includes(OrganizationRoles.ADMIN)}
              className="rounded"
            />
            <span className="text-sm">Admin</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="targetOwner"
              defaultChecked={targetRoles.includes(OrganizationRoles.OWNER)}
              className="rounded"
            />
            <span className="text-sm">Owner</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="targetSelfService"
              defaultChecked={targetRoles.includes(
                OrganizationRoles.SELF_SERVICE
              )}
              className="rounded"
            />
            <span className="text-sm">Self Service</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="targetBase"
              defaultChecked={targetRoles.includes(OrganizationRoles.BASE)}
              className="rounded"
            />
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
              defaultChecked={status === UpdateStatus.DRAFT}
              className="rounded"
            />
            <span className="text-sm">Draft</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="status"
              value={UpdateStatus.PUBLISHED}
              defaultChecked={status === UpdateStatus.PUBLISHED}
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
        <Button type="submit" variant="primary" disabled={disabled}>
          {isEdit ? "Update" : "Create Update"}
        </Button>
        <Button to=".." variant="secondary" disabled={disabled}>
          Cancel
        </Button>
      </div>
    </Form>
  );
}
