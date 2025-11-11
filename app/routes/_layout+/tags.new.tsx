import { TagUseFor } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import MultiSelect from "~/components/multi-select/multi-select";

import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";

import { createTag } from "~/modules/tag/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import { formatEnum } from "~/utils/misc";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const NewTagFormSchema = z.object({
  name: z.string().min(3, "Name is required"),
  description: z.string(),
  useFor: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value.split(",") : []))
    .pipe(z.array(z.nativeEnum(TagUseFor)).optional().default([])),
});

const title = "New Tag";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.tag,
      action: PermissionAction.create,
    });

    const header = {
      title,
    };

    return payload({
      header,
      tagUseFor: Object.values(TagUseFor).map((useFor) => ({
        label: formatEnum(useFor),
        value: useFor,
      })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.tag,
      action: PermissionAction.create,
    });

    const payload = parseData(await request.formData(), NewTagFormSchema, {
      additionalData: { userId, organizationId },
    });

    await createTag({
      ...payload,
      userId: authSession.userId,
      organizationId,
    });

    sendNotification({
      title: "Tag created",
      message: "Your tag has been created successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/tags`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function NewTag() {
  const zo = useZorm("NewQuestionWizardScreen", NewTagFormSchema);
  const { tagUseFor } = useLoaderData<typeof loader>();

  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();

  return (
    <>
      <Form
        method="post"
        className="block rounded border border-gray-200 bg-white px-6 py-5 "
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
              required={zodFieldIsRequired(NewTagFormSchema.shape.name)}
            />
            <Input
              label="Description"
              placeholder="Description (optional)"
              name={zo.fields.description()}
              disabled={disabled}
              data-test-id="tagDescription"
              className="mb-4 lg:mb-0"
              required={zodFieldIsRequired(NewTagFormSchema.shape.description)}
            />

            <MultiSelect
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
              Create
            </Button>
          </div>
        </div>

        {actionData?.error ? (
          <div className="mt-3 text-sm text-error-500">
            {actionData?.error.message}
          </div>
        ) : null}
      </Form>
    </>
  );
}
