import { OrganizationType } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import { LocationMarkerIcon } from "~/components/icons";
import { LocationSelect } from "~/components/location";
import { Button } from "~/components/shared/button";
import { getAllRelatedEntries, getAsset, updateAsset } from "~/modules/asset";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { getOrganizationByUserId } from "~/modules/organization";
import styles from "~/styles/layout/custom-modal.css";
import { assertIsPost, getRequiredParam, isFormProcessing } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { userId } = await requireAuthSession(request);
  const organization = await getOrganizationByUserId({
    userId,
    orgType: OrganizationType.PERSONAL,
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  const { locations } = await getAllRelatedEntries({
    userId,
    organizationId: organization.id,
  });

  const id = getRequiredParam(params, "assetId");
  const asset = await getAsset({ userId, id });

  return json({
    asset,
    locations,
    showModal: true,
  });
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);

  const id = getRequiredParam(params, "assetId");

  const formData = await request.formData();
  const newLocationId = formData.get("newLocationId");
  const currentLocationId = formData.get("currentLocationId");

  await updateAsset({
    id,
    newLocationId,
    currentLocationId,
    userId: authSession.userId,
  });

  sendNotification({
    title: "Location updated",
    message: "Your asset's location has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/assets/${id}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  return (
    <>
      <Form method="post">
        <div className="modal-content-wrapper">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
            <LocationMarkerIcon />
          </div>
          <div className="mb-5">
            <h4>Update Location</h4>
            <p>Adjust the location of this asset.</p>
          </div>
          <div className=" relative z-50 mb-8">
            <LocationSelect />
          </div>

          <div className="flex gap-3">
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
          </div>
        </div>
      </Form>
    </>
  );
}
