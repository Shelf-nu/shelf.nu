import { AssetStatus, BookingStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { WarningBox } from "~/components/shared/warning-box";
import { db } from "~/database/db.server";
import { createNote } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";
import { stringToJSONSchema } from "~/utils/zod";
import type { AssetWithBooking } from "./bookings.$bookingId.add-assets";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
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
      action: PermissionAction.update,
    });

    const asset = await db.asset
      .findUnique({
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
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching asset. Please try again or contact support.",
          additionalData: { userId, assetId, organizationId },
          label: "Assets",
        });
      });

    /** If the asset already has a custody, this page should not be visible */
    if (asset && asset.custody) {
      return redirect(`/assets/${assetId}`);
    }

    const searchParams = getCurrentSearchParams(request);

    /** We get all the team members that are part of the user's personal organization */
    const teamMembers = await db.teamMember
      .findMany({
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
        take: searchParams.get("getAll") === "teamMember" ? undefined : 12,
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching team members. Please try again or contact support.",
          additionalData: { userId, assetId, organizationId },
          label: "Assets",
        });
      });

    const totalTeamMembers = await db.teamMember.count({
      where: {
        deletedAt: null,
        organizationId,
      },
    });

    return json(
      data({
        showModal: true,
        teamMembers,
        asset,
        totalTeamMembers,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
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
      action: PermissionAction.update,
    });

    const { custodian } = parseData(
      await request.formData(),
      z.object({
        custodian: stringToJSONSchema.pipe(
          z.object({
            id: z.string(),
            name: z.string(),
          })
        ),
      }),
      {
        additionalData: { userId, assetId },
        message: "Please select a custodian",
        shouldBeCaptured: false,
      }
    );

    const user = await getUserByID(userId);

    /** We send the data from the form as a json string, so we can easily have both the name and id
     * ID is used to connect the asset to the custodian
     * Name is used to create the note
     */
    const { id: custodianId, name: custodianName } = custodian;

    /** In order to do it with a single query
     * 1. We update the asset status
     * 2. We create a new custody record for that specific asset
     * 3. We link it to the custodian
     */
    const asset = await db.asset
      .update({
        where: { id: assetId },
        data: {
          status: AssetStatus.IN_CUSTODY,
          custody: {
            create: {
              custodian: { connect: { id: custodianId } },
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
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while updating asset. Please try again or contact support.",
          additionalData: { userId, assetId, custodianId },
          label: "Assets",
        });
      });

    /** Once the asset is updated, we create the note */
    await createNote({
      content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName.trim()}** custody over **${asset.title.trim()}**`,
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
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const { asset } = useLoaderData<typeof loader>();
  const hasBookings = (asset?.bookings?.length ?? 0) > 0 || false;
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  return (
    <>
      <Form method="post">
        <div className="modal-content-wrapper">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
            <UserIcon />
          </div>
          <div className="mb-5">
            <h4>Assign custody of asset</h4>
            <p>
              This asset is currently available. You’re about to assign custody
              to one of your team members.
            </p>
          </div>
          <div className=" relative z-50 mb-8">
            <DynamicSelect
              disabled={disabled}
              model={{
                name: "teamMember",
                queryKey: "name",
                deletedAt: null,
              }}
              fieldName="custodian"
              contentLabel="Team members"
              initialDataKey="teamMembers"
              countKey="totalTeamMembers"
              placeholder="Select a team member"
              allowClear
              closeOnSelect
              transformItem={(item) => ({
                ...item,
                id: JSON.stringify({
                  id: item.id,
                  //If there is a user, we use its name, otherwise we use the name of the team member
                  name: resolveTeamMemberName(item),
                }),
              })}
              renderItem={(item) => resolveTeamMemberName(item, true)}
            />
          </div>
          {actionData?.error ? (
            <div className="-mt-8 mb-8 text-sm text-error-500">
              {actionData.error.message}
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
