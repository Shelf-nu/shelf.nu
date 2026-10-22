import { useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { ColorBadgePreview } from "~/components/forms/color-badge-preview";
import { ColorInput } from "~/components/forms/color-input";
import { FormRowErrors, rowErrorId } from "~/components/forms/form-row-errors";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";

import { getCategory, updateCategory } from "~/modules/category/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import { error, getParams, payload, parseData } from "~/utils/http.server";
import { hexColorSchema, labelNameSchema } from "~/utils/label-form-fields";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const UpdateCategoryFormSchema = z.object({
  name: labelNameSchema,
  description: z.string(),
  color: hexColorSchema,
});

const title = "Edit category";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { categoryId: id } = getParams(
    params,
    z.object({ categoryId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.category,
      action: PermissionAction.update,
    });

    const category = await getCategory({ id, organizationId });

    const colorFromServer = category.color;

    const header = { title };

    return payload({ header, colorFromServer, category });
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
  const { categoryId: id } = getParams(
    params,
    z.object({ categoryId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.category,
      action: PermissionAction.update,
    });

    const payload = parseData(
      await request.formData(),
      UpdateCategoryFormSchema,
      {
        additionalData: { userId, id, organizationId },
      }
    );

    await updateCategory({
      ...payload,
      id,
      organizationId,
    });

    sendNotification({
      title: "Category Updated",
      message: "Your category has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/categories`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
  }
}

export default function EditCategory() {
  const zo = useZorm("NewQuestionWizardScreen", UpdateCategoryFormSchema);
  const disabled = useDisabled();

  // Focus the Name input on mount of the edit page.
  const nameInputRef = useAutoFocus<HTMLInputElement>();
  const { colorFromServer, category } = useLoaderData<typeof loader>();
  /** Live name and color for the badge preview under the field row */
  const [previewName, setPreviewName] = useState<string>(category.name);
  const [previewColor, setPreviewColor] = useState<string | null>(
    colorFromServer || null
  );
  const actionData = useActionData<typeof action>();
  /** Server-side errors, shown when client-side validation is bypassed */
  const validationErrors = getValidationErrors<typeof UpdateCategoryFormSchema>(
    actionData?.error
  );
  const nameError =
    validationErrors?.name?.message || zo.errors.name()?.message;
  const colorError =
    validationErrors?.color?.message || zo.errors.color()?.message;
  /** The row is bottom-aligned, so field errors render below it, not per input */
  const errorsId = "category-form-errors";

  return (
    <Form
      key={category.id}
      method="post"
      className="block rounded border border-gray-200 bg-white px-6 py-5"
      ref={zo.ref}
    >
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-3">
        <div className="gap-3 lg:flex lg:items-end">
          <Input
            ref={nameInputRef}
            label="Name"
            placeholder="Category name"
            className="mb-4 lg:mb-0 lg:max-w-[180px]"
            name={zo.fields.name()}
            onChange={(e) => setPreviewName(e.target.value)}
            disabled={disabled}
            error={nameError}
            hideErrorText
            aria-describedby={
              nameError ? rowErrorId(errorsId, "name") : undefined
            }
            required={zodFieldIsRequired(UpdateCategoryFormSchema.shape.name)}
            defaultValue={category.name}
          />
          <Input
            label="Description"
            placeholder="Description (optional)"
            name={zo.fields.description()}
            disabled={disabled}
            data-test-id="categoryDescription"
            className="mb-4 lg:mb-0"
            required={zodFieldIsRequired(
              UpdateCategoryFormSchema.shape.description
            )}
            defaultValue={category.description || undefined}
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
              required
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="secondary" to="/categories" size="sm">
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
  );
}
