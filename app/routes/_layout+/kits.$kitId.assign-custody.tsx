import { AssetStatus, BookingStatus, KitStatus } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
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
import { getKit } from "~/modules/kit/service.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  assertIsPost,
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

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: {
      userId,
    },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const kit = await getKit({
      id: kitId,
      organizationId,
      extraInclude: {
        assets: {
          select: {
            status: true,
            bookings: {
              where: {
                status: {
                  in: [BookingStatus.RESERVED],
                },
                from: { gt: new Date() },
              },
              select: { id: true },
            },
          },
        },
      },
    });

    if (kit.custody) {
      return redirect(`/kits/${kitId}`);
    }

    /**
     * If any asset is not available in a kit,
     * then a kit cannot be assigned a custody
     */
    const someUnavailableAsset = kit.assets.some(
      (asset) => asset.status !== "AVAILABLE"
    );
    if (someUnavailableAsset) {
      sendNotification({
        title: "Cannot assign custody at this time.",
        message: "One of the asset in kit is not available",
        icon: { name: "trash", variant: "error" },
        senderId: userId,
      });

      return redirect(`/kits/${kitId}`);
    }

    const searchParams = getCurrentSearchParams(request);

    const teamMembers = await db.teamMember
      .findMany({
        where: { deletedAt: null, organizationId },
        include: { user: true },
        orderBy: { userId: "asc" },
        take: searchParams.get("getAll") === "teamMember" ? undefined : 12,
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching team members. Please try again or contact support.",
          label: "Kit",
        });
      });

    const totalTeamMembers = await db.teamMember.count({
      where: { deletedAt: null, organizationId },
    });

    return json(
      data({
        showModal: true,
        kit,
        teamMembers,
        totalTeamMembers,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const { custodian } = parseData(
      await request.formData(),
      z.object({
        custodian: stringToJSONSchema.pipe(
          z.object({ id: z.string(), name: z.string() })
        ),
      }),
      { additionalData: { userId, kitId } }
    );

    const { id: custodianId, name: custodianName } = custodian;

    const user = await getUserByID(userId);

    const kit = await db.kit.update({
      where: { id: kitId },
      data: {
        status: KitStatus.IN_CUSTODY,
        custody: { create: { custodian: { connect: { id: custodianId } } } },
      },
      include: {
        assets: true,
      },
    });

    await Promise.all([
      /**
       * Assign custody to all assets of kit
       */
      ...kit.assets.map((asset) =>
        db.asset.update({
          where: { id: asset.id },
          data: {
            status: AssetStatus.IN_CUSTODY,
            custody: {
              create: { custodian: { connect: { id: custodianId } } },
            },
          },
        })
      ),
      /**
       * Create note for each asset
       */
      db.note.createMany({
        data: kit.assets.map((asset) => ({
          content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName.trim()}** custody over **${asset.title.trim()}** via Kit assignment **[${
            kit.name
          }](/kits/${kit.id})**`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        })),
      }),
    ]);

    sendNotification({
      title: `‘${kit.name}’ is now in custody of ${custodianName}`,
      message:
        "Remember, this kit will be unavailable until it is manually checked in.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/kits/${kitId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function GiveKitCustody() {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const actionData = useActionData<typeof action>();
  const { kit } = useLoaderData<typeof loader>();

  const hasBookings = kit.assets.some((asset) => asset.bookings.length > 0);

  return (
    <Form method="post">
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
          <UserIcon />
        </div>

        <div className="mb-5">
          <h4>Assign custody of kit</h4>
          <p>
            This kit is currently available. You're about to assign custody to
            one of your team members. All the assets in this kit will also be
            assigned the same custody.
          </p>
        </div>

        <div className="relative z-50 mb-8">
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
            closeOnSelect
            transformItem={(item) => ({
              ...item,
              id: JSON.stringify({
                id: item.id,
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
              Kit is part of an{" "}
              <Link
                to={`/bookings/${kit.assets[0].bookings[0].id}`}
                className="underline"
                target="_blank"
              >
                upcoming booking
              </Link>
              . You will not be able to check-out your booking if this kit has
              custody.
            </>
          </WarningBox>
        ) : null}

        <div className="flex gap-3">
          <Button to=".." variant="secondary" width="full" disabled={disabled}>
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
  );
}
