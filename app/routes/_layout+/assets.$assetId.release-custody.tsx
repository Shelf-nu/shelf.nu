import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { UserXIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import { db } from "~/database";
import { createNote } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { releaseCustody } from "~/modules/custody";
import { getUserByID } from "~/modules/user";
import styles from "~/styles/layout/custom-modal.css";
import { isFormProcessing } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireAuthSession(request);
  const custody = await db.custody.findUnique({
    where: { assetId: params.assetId as string },
    select: {
      custodian: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!custody) return redirect(`/assets/${params.assetId}`);

  return json({
    showModal: true,
    custody,
    asset: await db.asset.findUnique({
      where: { id: params.assetId as string },
      select: {
        title: true,
      },
    }),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { userId } = await requireAuthSession(request);
  const assetId = params.assetId as string;
  const user = await getUserByID(userId);

  if (!user)
    throw new ShelfStackError({
      message:
        "User not found. Please refresh and if the issue persists contact support.",
    });

  const asset = await releaseCustody({ assetId });
  if (!asset.custody) {
    const formData = await request.formData();
    const custodianName = formData.get("custodianName") as string;

    /** Once the asset is updated, we create the note */
    await createNote({
      content: `**${user.firstName} ${user.lastName}** has released **${custodianName}'s** custody over **${asset.title}**`,
      type: "UPDATE",
      userId: asset.userId,
      assetId: asset.id,
    });
    sendNotification({
      title: `‘${asset.title}’ is no longer in custody of ‘${custodianName}’`,
      message: "This asset is available again.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });
  }

  return redirect(`/assets/${assetId}`);
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const { custody, asset } = useLoaderData<typeof loader>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
          <UserXIcon />
        </div>
        <div className="mb-5">
          <h4>Releasing custody</h4>
          <p>
            Are you sure you want to release{" "}
            <span className="font-medium">{custody?.custodian.name}’s</span>{" "}
            custody over <span className="font-medium">{asset?.title}</span>?
          </p>
        </div>
        <div className="">
          <Form method="post" className="flex w-full gap-3">
            <input
              type="hidden"
              name="custodianName"
              value={custody?.custodian.name}
            />
            <Button
              to=".."
              variant="secondary"
              width="full"
              disabled={disabled}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              width="full"
              type="submit"
              disabled={disabled}
            >
              Confirm
            </Button>
          </Form>
        </div>
      </div>
    </>
  );
}
