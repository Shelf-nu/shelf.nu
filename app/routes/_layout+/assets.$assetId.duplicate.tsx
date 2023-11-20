import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { ErrorContent } from "~/components/errors";
import Input from "~/components/forms/input";
import { Badge, Button } from "~/components/shared";
import { Spinner } from "~/components/shared/spinner";
import { db } from "~/database";
import { duplicateAsset } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import styles from "~/styles/layout/custom-modal.css";
import {
  assertIsPost,
  error,
  isFormProcessing,
  userFriendlyAssetStatus,
} from "~/utils";
import { MAX_DUPLICATES_ALLOWED } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError, makeShelfError } from "~/utils/error";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    await requireAuthSession(request);

    const assetId = params.assetId as string;
    const asset = await db.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new ShelfStackError({ message: "Asset Not Found", status: 404 });
    }

    return json({
      showModal: true,
      asset,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(
      { asset: null, showModal: true, ...error(reason) },
      { status: reason.status }
    );
  }
};

const DuplicateAssetSchema = z.object({
  amountOfDuplicates: z.coerce
    .number()
    .min(1, { message: "There should be at least 1 duplicate." })
    .max(MAX_DUPLICATES_ALLOWED, {
      message: `There can be a max of ${MAX_DUPLICATES_ALLOWED} duplicates created at a time.`,
    }),
});

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    assertIsPost(request);

    const authSession = await requireAuthSession(request);
    const { organizationId } = await requireOrganisationId(
      authSession,
      request
    );
    const { userId } = authSession;

    const assetId = params.assetId as string;
    const asset = await db.asset.findUnique({
      where: { id: assetId },
      include: { custody: { include: { custodian: true } }, tags: true },
    });
    if (!asset) {
      throw new ShelfStackError({ message: "Asset Not Found", status: 404 });
    }

    const formData = await request.formData();
    const result = await DuplicateAssetSchema.safeParseAsync(
      parseFormAny(formData)
    );

    if (!result.success) {
      return json({ error: { ...result.error } }, { status: 400 });
    }

    const amountOfDuplicates = Number(result.data.amountOfDuplicates);

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
    const reason = makeShelfError(cause);
    return json(
      { showModal: true, ...error(reason) },
      { status: reason.status }
    );
  }
};

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

        {asset ? (
          <div className="flex items-center gap-3 rounded-md border p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: asset.id,
                  mainImage: asset.mainImage,
                  mainImageExpiration: asset.mainImageExpiration,
                  alt: asset.title,
                }}
                className="h-full w-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                {asset.title}
              </span>
              <div>
                <Badge
                  color={asset.status === "AVAILABLE" ? "#12B76A" : "#2E90FA"}
                >
                  {userFriendlyAssetStatus(asset.status)}
                </Badge>
              </div>
            </div>
          </div>
        ) : null}

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
            // @ts-ignore
            actionData?.error?.amountOfDuplicates
          }
        />

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
            {/*@ts-ignore */}
            <p className="font-medium">{actionData.error?.title || ""}</p>
            {/* @ts-ignore */}
            <p>{actionData?.error?.message}</p>
          </div>
        ) : null}
      </div>
    </Form>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
