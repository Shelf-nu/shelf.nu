import { useState } from "react";
import { TagUseFor } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { ColorBadgePreview } from "~/components/forms/color-badge-preview";
import { ColorInput } from "~/components/forms/color-input";
import { FormRowErrors, rowErrorId } from "~/components/forms/form-row-errors";
import Input from "~/components/forms/input";
import MultiSelect from "~/components/multi-select/multi-select";
import { Button } from "~/components/shared/button";
import { useAutoFocus } from "~/hooks/use-auto-focus";

import { useDisabled } from "~/hooks/use-disabled";

import { getTag, updateTag } from "~/modules/tag/service.server";
import {
  selectedTagUseForOptions,
  tagUseForOptions,
} from "~/modules/tag/use-for-options";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  labelNameSchema,
  optionalHexColorSchema,
} from "~/utils/label-form-fields";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const UpdateTagFormSchema = z.object({
  name: labelNameSchema,
  description: z.string(),
  color: optionalHexColorSchema,
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

    return payload({
      header,
      tag,
      colorFromServer: tag.color ?? undefined,
      tagUseFor: tagUseForOptions(),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw data(error(reason), { status: reason.status });
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
    return data(error(reason), { status: reason.status });
  }
}

export default function EditTag() {
  // Focus the Name input on mount of the edit page.
  const nameInputRef = useAutoFocus<HTMLInputElement>();
  const zo = useZorm("NewQuestionWizardScreen", UpdateTagFormSchema);
  const { tag, tagUseFor, colorFromServer } = useLoaderData<typeof loader>();
  /** Live name and color for the badge preview under the field row */
  const [previewName, setPreviewName] = useState<string>(tag?.name ?? "");
  const [previewColor, setPreviewColor] = useState<string | null>(
    colorFromServer || null
  );
  const actionData = useActionData<typeof action>();
  /** Server-side errors, shown when client-side validation is bypassed */
  const validationErrors = getValidationErrors<typeof UpdateTagFormSchema>(
    actionData?.error
  );
  const nameError =
    validationErrors?.name?.message || zo.errors.name()?.message;
  const colorError =
    validationErrors?.color?.message || zo.errors.color()?.message;
  /** The row is bottom-aligned, so field errors render below it, not per input */
  const errorsId = "tag-form-errors";
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
              ref={nameInputRef}
              label="Name"
              placeholder="Tag name"
              className="mb-4 lg:mb-0 lg:max-w-[180px]"
              name={zo.fields.name()}
              onChange={(e) => setPreviewName(e.target.value)}
              disabled={disabled}
              error={nameError}
              hideErrorText
              aria-describedby={
                nameError ? rowErrorId(errorsId, "name") : undefined
              }
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
            <div className="mb-6 lg:mb-0">
              <ColorInput
                name={zo.fields.color()}
                disabled={disabled}
                error={colorError}
                hideErrorText
                aria-describedby={
                  colorError ? rowErrorId(errorsId, "color") : undefined
                }
                colorFromServer={colorFromServer}
                onColorChange={setPreviewColor}
                required={zodFieldIsRequired(UpdateTagFormSchema.shape.color)}
              />
            </div>

            <MultiSelect
              defaultSelected={selectedTagUseForOptions(tag.useFor)}
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

        <ColorBadgePreview name={previewName} color={previewColor} />
        <FormRowErrors
          id={errorsId}
          errors={{ name: nameError, color: colorError }}
        />
        {/* Any other failure (e.g. a duplicate name) has no field to point at */}
        {actionData?.error && !nameError && !colorError ? (
          <div className="mt-3 text-sm text-error-500">
            {actionData.error.message}
          </div>
        ) : null}
      </Form>
    </>
  ) : null;
}
