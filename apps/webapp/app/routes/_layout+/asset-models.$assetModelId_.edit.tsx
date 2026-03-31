import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import {
  getAssetModel,
  updateAssetModel,
} from "~/modules/asset-model/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { error, getParams, payload, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { zodFieldIsRequired } from "~/utils/zod";

/** Zod schema for updating an asset model. */
export const UpdateAssetModelFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  defaultValuation: z
    .string()
    .optional()
    .transform((val) => (val ? +val : null)),
});

const title = "Edit asset model";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetModelId: id } = getParams(
    params,
    z.object({ assetModelId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.update,
    });

    const assetModel = await getAssetModel({ id, organizationId });

    const header = { title };

    return payload({ header, assetModel });
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
  const { assetModelId: id } = getParams(
    params,
    z.object({ assetModelId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.update,
    });

    const parsedPayload = parseData(
      await request.formData(),
      UpdateAssetModelFormSchema,
      { additionalData: { userId, id, organizationId } }
    );

    await updateAssetModel({
      ...parsedPayload,
      id,
      organizationId,
    });

    sendNotification({
      title: "Asset model updated",
      message: "Your asset model has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect("/asset-models");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
  }
}

export default function EditAssetModel() {
  const zo = useZorm("EditAssetModelForm", UpdateAssetModelFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const { assetModel } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Form
      key={assetModel.id}
      method="post"
      className="block rounded border border-gray-200 bg-white px-6 py-5"
      ref={zo.ref}
    >
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-3">
        <div className="gap-3 lg:flex lg:items-end">
          <Input
            label="Name"
            placeholder="Asset model name"
            className="mb-4 lg:mb-0 lg:max-w-[180px]"
            name={zo.fields.name()}
            disabled={disabled}
            error={zo.errors.name()?.message}
            hideErrorText
            autoFocus
            required={zodFieldIsRequired(UpdateAssetModelFormSchema.shape.name)}
            defaultValue={assetModel.name}
          />
          <Input
            label="Description"
            placeholder="Description (optional)"
            name={zo.fields.description()}
            disabled={disabled}
            className="mb-4 lg:mb-0"
            defaultValue={assetModel.description || undefined}
          />
          <Input
            label="Default valuation"
            type="number"
            step="0.01"
            placeholder="0.00"
            name={zo.fields.defaultValuation()}
            disabled={disabled}
            className="mb-4 lg:mb-0 lg:max-w-[140px]"
            defaultValue={
              assetModel.defaultValuation != null
                ? String(assetModel.defaultValuation)
                : undefined
            }
          />
        </div>

        <div className="flex items-center gap-1">
          <Button variant="secondary" to="/asset-models" size="sm">
            Cancel
          </Button>
          <Button type="submit" size="sm">
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
  );
}
