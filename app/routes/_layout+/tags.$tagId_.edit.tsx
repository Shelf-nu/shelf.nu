import { TagUseFor } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import MultiSelect from "~/components/multi-select/multi-select";

import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";

import { getTag, updateTag } from "~/modules/tag/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { formatEnum } from "~/utils/misc";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const UpdateTagFormSchema = z.object({
  name: z.string().min(3, "Name is required"),
  description: z.string(),
  useFor: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value.split(",") : []))
    .pipe(z.array(z.nativeEnum(TagUseFor)).optional().default([])),
});

const title = "Edit Tag";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { tagId: id } = getParams(params, z.object({ tagId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.tag,
      action: PermissionAction.update,
    });

    const tag = await getTag({ id, organizationId });

    const header = {
      title,
    };

    return json(
      payload({
        header,
        tag,
        tagUseFor: Object.values(TagUseFor).map((useFor) => ({
          label: formatEnum(useFor),
          value: useFor,
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { tagId: id } = getParams(params, z.object({ tagId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.tag,
      action: PermissionAction.update,
    });

    const payload = parseData(await request.formData(), UpdateTagFormSchema, {
      additionalData: { userId, id, organizationId },
    });

    await updateTag({
      ...payload,
      id,
      organizationId,
    });

    sendNotification({
      title: "Tag Updated",
      message: "Your tag has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/tags`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function EditTag() {
  const zo = useZorm("NewQuestionWizardScreen", UpdateTagFormSchema);
  const { tag, tagUseFor } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const disabled = useDisabled();

  return tag ? (
    <>
      <Form
        method="post"
        className="block rounded-[12px] border border-gray-200 bg-white px-6 py-5 "
        ref={zo.ref}
      >
        <div className="lg:flex lg:items-end lg:justify-between lg:gap-3">
          <div className="gap-3 lg:flex lg:items-end">
            <Input
              label="Name"
              placeholder="Tag name"
              className="mb-4 lg:mb-0 lg:max-w-[180px]"
              name={zo.fields.name()}
              disabled={disabled}
              error={zo.errors.name()?.message}
              hideErrorText
              autoFocus
              required={zodFieldIsRequired(UpdateTagFormSchema.shape.name)}
              defaultValue={tag.name}
            />
            <Input
              label="Description"
              placeholder="Description (optional)"
              name={zo.fields.description()}
              disabled={disabled}
              data-test-id="tagDescription"
              className="mb-4 lg:mb-0"
              required={zodFieldIsRequired(
                UpdateTagFormSchema.shape.description
              )}
              defaultValue={tag.description || undefined}
            />

            <MultiSelect
              defaultSelected={tag.useFor.map((useFor) => ({
                label: useFor,
                value: useFor,
              }))}
              name="useFor"
              items={tagUseFor}
              labelKey="label"
              valueKey="value"
              label="Use for"
              placeholder="Select use for"
              tooltip={{
                title: "Use for",
                content:
                  "When no specific entry is selected, this tag will be available for all entries.",
              }}
            />
          </div>

          <div className="flex gap-1">
            <Button
              variant="secondary"
              to="/tags"
              size="sm"
              disabled={disabled}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={disabled}>
              Update
            </Button>
          </div>
        </div>

        {actionData?.error ? (
          <div className="mt-3 text-sm text-error-500">
            {actionData?.error?.message}
          </div>
        ) : null}
      </Form>
    </>
  ) : null;
}
