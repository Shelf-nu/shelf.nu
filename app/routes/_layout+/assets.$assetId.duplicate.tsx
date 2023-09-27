import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { AssetImage } from "~/components/assets/asset-image";
import Input from "~/components/forms/input";
import { Badge, Button } from "~/components/shared";
import { Spinner } from "~/components/shared/spinner";
import { db } from "~/database";
import { duplicateAsset } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import styles from "~/styles/layout/custom-modal.css";
import {
  assertIsPost,
  isFormProcessing,
  userFriendlyAssetStatus,
} from "~/utils";
import { MAX_DUPLICATES_ALLOWED } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";

export const loader = async ({ params }: LoaderArgs) => {
  const assetId = params.assetId as string;
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    throw new ShelfStackError({ message: "Asset Not Found", status: 404 });
  }

  return json({
    showModal: true,
    asset,
  });
};

export const action = async ({ request, params }: ActionArgs) => {
  assertIsPost(request);

  const { userId } = await requireAuthSession(request);
  const assetId = params.assetId as string;
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    include: { custody: true },
  });
  if (!asset) {
    throw new ShelfStackError({ message: "Asset Not Found", status: 404 });
  }

  const formData = await request.formData();
  const amountOfDuplicates =
    (formData.get("amountOfDuplicates") as string) ?? 1;

  const allowedDuplicates = Math.min(
    Number(amountOfDuplicates),
    MAX_DUPLICATES_ALLOWED
  );

  const duplicatedAssets = await duplicateAsset({
    asset,
    userId,
    amountOfDuplicates: allowedDuplicates,
  });

  sendNotification({
    title: "Asset successfully duplicated",
    message: `${asset.title} has been duplicated.`,
    icon: { name: "success", variant: "success" },
    senderId: userId,
  });

  return redirect(
    `/assets/${allowedDuplicates > 1 ? "" : duplicatedAssets[0].id}`
  );
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function DuplicateAsset() {
  const { asset } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isProcessing = isFormProcessing(navigation.state);

  return (
    <Form method="post">
      <div className="modal-content-wrapper space-y-6">
        <div className="w-full border-b pb-4 text-lg font-semibold">
          Duplicate asset
        </div>

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

        <Input
          inputType="number"
          label="Amount of duplicates"
          name="amountOfDuplicates"
          defaultValue={1}
          placeholder="How many duplicates assets you want to create for this asset ?"
          data-test-id="amountOfDuplicates"
          min="1"
          max={MAX_DUPLICATES_ALLOWED.toString()}
          className="w-full"
          disabled={isProcessing}
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
      </div>
    </Form>
  );
}
