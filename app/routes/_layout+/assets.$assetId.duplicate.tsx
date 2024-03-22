import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { db } from "~/database/db.server";
import { duplicateAsset } from "~/modules/asset";
import styles from "~/styles/layout/custom-modal.css";
import { data, error, getParams, isFormProcessing, parseData } from "~/utils";
import { MAX_DUPLICATES_ALLOWED } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });

    const asset = await db.asset
      .findFirstOrThrow({ where: { id: assetId } })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Asset Not Found",
          message:
            "The asset you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { userId, assetId },
          status: 404,
          label: "Assets",
        });
      });

    return json(
      data({
        showModal: true,
        asset,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });

    const asset = await db.asset
      .findFirstOrThrow({
        where: { id: assetId },
        include: { custody: { include: { custodian: true } }, tags: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Asset Not Found",
          message:
            "The asset you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { userId, assetId },
          status: 404,
          label: "Assets",
        });
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
    return json(error(reason), { status: reason.status });
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
      <div className="modal-content-wrapper space-y-6">
        <div className="w-full border-b pb-4 text-lg font-semibold">
          Duplicate asset
        </div>

        <div className="flex items-center gap-3 rounded-md border p-4">
          <div className="flex size-12 shrink-0 items-center justify-center">
            <AssetImage
              asset={{
                assetId: asset.id,
                mainImage: asset.mainImage,
                mainImageExpiration: asset.mainImageExpiration,
                alt: asset.title,
              }}
              className="size-full rounded-[4px] border object-cover"
            />
          </div>
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {asset.title}
            </span>
            <div>
              <AssetStatusBadge
                status={asset.status}
                availableToBook={asset.availableToBook}
              />
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
        <div className="flex gap-3">
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
