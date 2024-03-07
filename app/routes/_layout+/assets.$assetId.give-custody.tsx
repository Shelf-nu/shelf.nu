import { AssetStatus, BookingStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import CustodianSelect from "~/components/custody/custodian-select";
import { UserIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import { WarningBox } from "~/components/shared/warning-box";
import { db } from "~/database";
import { createNote } from "~/modules/asset";
import { getUserByID } from "~/modules/user";
import styles from "~/styles/layout/custom-modal.css";
import { isFormProcessing } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import type { AssetWithBooking } from "./bookings.$bookingId.add-assets";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = await context.getSession();
  const { userId } = authSession;
  const { organizationId } = await requirePermision({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

  const assetId = params.assetId as string;
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    select: {
      custody: {
        select: {
          id: true,
        },
      },
      bookings: {
        where: {
          status: {
            in: [BookingStatus.RESERVED],
          },
        },
        select: {
          id: true,
        },
      },
    },
  });
  /** If the asset already has a custody, this page should not be visible */
  if (asset && asset.custody) {
    return redirect(`/assets/${assetId}`);
  }

  /** We get all the team members that are part of the user's personal organization */
  const teamMembers = await db.teamMember.findMany({
    where: {
      deletedAt: null,
      organizationId,
    },
    include: {
      user: true,
    },
    orderBy: {
      userId: "asc",
    },
  });

  return json({
    showModal: true,
    teamMembers,
    asset,
  });
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = await context.getSession();
  const { userId } = authSession;
  await requirePermision({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

  const formData = await request.formData();
  const assetId = params.assetId as string;
  const custodian = formData.get("custodian");
  const user = await getUserByID(userId);

  if (!user)
    throw new ShelfStackError({
      message:
        "User not found. Please refresh and if the issue persists contact support.",
    });

  if (!custodian)
    return json({ error: "Please select a custodian" }, { status: 400 });

  /** We send the data from the form as a json string, so we can easily have both the name and id
   * ID is used to connect the asset to the custodian
   * Name is used to create the note
   */
  const { id: custodianId, name: custodianName } = JSON.parse(
    custodian as string
  );

  /** In order to do it with a single query
   * 1. We update the asset status
   * 2. We create a new custody record for that specific asset
   * 3. We link it to the custodian
   */
  const asset = await db.asset.update({
    where: { id: assetId },
    data: {
      status: AssetStatus.IN_CUSTODY,
      custody: {
        create: {
          custodian: { connect: { id: custodianId as string } },
        },
      },
    },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  /** Once the asset is updated, we create the note */
  await createNote({
    content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName?.trim()}** custody over **${asset.title?.trim()}**`,
    type: "UPDATE",
    userId: userId,
    assetId: asset.id,
  });

  sendNotification({
    title: `‘${asset.title}’ is now in custody of ${custodianName}`,
    message:
      "Remember, this asset will be unavailable until custody is manually released.",
    icon: { name: "success", variant: "success" },
    senderId: userId,
  });

  return redirect(`/assets/${assetId}`);
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const { asset } = useLoaderData<typeof loader>();
  const hasBookings = (asset?.bookings?.length ?? 0) > 0 || false;
  const actionData = useActionData<{ error: string } | null>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  return (
    <>
      <Form method="post">
        <div className="modal-content-wrapper">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
            <UserIcon />
          </div>
          <div className="mb-5">
            <h4>Give Custody</h4>
            <p>
              This asset is currently available. You’re about to give custody to
              one of your team members.
            </p>
          </div>
          <div className=" relative z-50 mb-8">
            <CustodianSelect />
          </div>
          {actionData?.error ? (
            <div className="-mt-8 mb-8 text-sm text-error-500">
              {actionData.error}
            </div>
          ) : null}

          {hasBookings ? (
            <WarningBox className="-mt-4 mb-8">
              <>
                Asset is part of an{" "}
                <Link
                  to={`/bookings/${(asset as AssetWithBooking).bookings[0].id}`}
                  className="underline"
                  target="_blank"
                >
                  upcoming booking
                </Link>
                . You will not be able to check-out your booking if this asset
                has custody.
              </>
            </WarningBox>
          ) : null}

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
