import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { data, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import Icon from "~/components/icons/icon";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { duplicateAsset, getAsset } from "~/modules/asset/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { MAX_DUPLICATES_ALLOWED } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });

    const asset = await getAsset({
      id: assetId,
      organizationId,
      userOrganizations,
      request,
    });

    return payload({
      header: {
        title: `Duplicate asset`,
        subHeading: "Choose the amount of duplicates you want to create.",
      },
      showModal: true,
      asset,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}

const DuplicateAssetSchema = z.object({
  amountOfDuplicates: z.coerce
    .number()
    .min(1, { message: "There should be at least 1 duplicate." })
    .max(MAX_DUPLICATES_ALLOWED, {
      message: `There can be a max of ${MAX_DUPLICATES_ALLOWED} duplicates created at a time.`,
    }),
});

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });

    const asset = await getAsset({
      id: assetId,
      organizationId,
      userOrganizations,
      include: {
        custody: { include: { custodian: true } },
        tags: true,
        customFields: true,
      },
    });

    const { amountOfDuplicates } = parseData(
      await request.formData(),
      DuplicateAssetSchema
    );

    const duplicatedAssets = await duplicateAsset({
      asset,
      userId,
      amountOfDuplicates,
      organizationId,
    });

    sendNotification({
      title: "Asset successfully duplicated",
      message: `${asset.title} has been duplicated.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(
      `/assets/${amountOfDuplicates > 1 ? "" : duplicatedAssets[0].id}`
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function DuplicateAsset() {
  const zo = useZorm("DuplicateAsset", DuplicateAssetSchema);
  const { asset } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isProcessing = isFormProcessing(navigation.state);
  const actionData = useActionData<typeof action>();

  return (
    <Form ref={zo.ref} method="post">
      <div className="modal-content-wrapper">
        <div className="inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
          <Icon icon="duplicate" />
        </div>
        <Header hideBreadcrumbs classNames="[&>div]:border-b-0" />

        <div className="flex flex-col items-center gap-3 ">
          <div className="flex w-full items-center gap-3 rounded-md border p-4">
            <div className="flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: asset.id,
                  mainImage: asset.mainImage,
                  thumbnailImage: asset.thumbnailImage,
                  mainImageExpiration: asset.mainImageExpiration,
                }}
                alt={`Image of ${asset.title}`}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                {asset.title}
              </span>
              <div>
                <AssetStatusBadge
                  id={asset.id}
                  status={asset.status}
                  availableToBook={asset.availableToBook}
                />
              </div>
            </div>
          </div>

          <Input
            type="number"
            label="Amount of duplicates"
            name={zo.fields.amountOfDuplicates()}
            defaultValue={1}
            placeholder="How many duplicates assets you want to create for this asset ?"
            className="w-full"
            disabled={isProcessing}
            required
            /* We have to find a way to normalize the error object when it comes from zod */
            error={
              zo.errors.amountOfDuplicates()?.message ||
              getValidationErrors<typeof DuplicateAssetSchema>(
                actionData?.error
              )?.amountOfDuplicates?.message
            }
          />
        </div>
        <div className="mt-6 flex gap-3">
          <Button
            to=".."
            variant="secondary"
            width="full"
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            width="full"
            type="submit"
            disabled={isProcessing}
          >
            {isProcessing ? <Spinner /> : "Duplicate"}
          </Button>
        </div>
        {actionData?.error ? (
          <div className="text-error-500">
            <p className="font-medium">{actionData.error?.title || ""}</p>
            <p>{actionData?.error?.message}</p>
          </div>
        ) : null}
      </div>
    </Form>
  );
}
