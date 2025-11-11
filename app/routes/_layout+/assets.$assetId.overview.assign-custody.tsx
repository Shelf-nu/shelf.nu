import type { Prisma } from "@prisma/client";
import { AssetStatus, BookingStatus, OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { WarningBox } from "~/components/shared/warning-box";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAsset } from "~/modules/asset/service.server";
import { AssignCustodySchema } from "~/modules/custody/schema";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  payload,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  wrapCustodianForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, role, userOrganizations } = await requirePermission(
      {
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.custody,
      }
    );

    const asset = await getAsset({
      id: assetId,
      organizationId,
      userOrganizations,
      request,
      include: {
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

    const searchParams = getCurrentSearchParams(request);

    /** We get all the team members that are part of the user's personal organization */
    const where = {
      deletedAt: null,
      organizationId,
      userId: role === OrganizationRoles.SELF_SERVICE ? userId : undefined,
    } satisfies Prisma.TeamMemberWhereInput;

    const teamMembers = await db.teamMember
      .findMany({
        where,
        include: { user: true },
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

    const totalTeamMembers = await db.teamMember.count({ where });

    return payload({
      showModal: true,
      teamMembers,
      asset,
      totalTeamMembers,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const { custodian } = parseData(
      await request.formData(),
      AssignCustodySchema,
      {
        additionalData: { userId, assetId },
        message: "Please select a team member",
        shouldBeCaptured: false,
      }
    );

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Prisma.UserSelect,
    });

    /** We send the data from the form as a json string, so we can easily have both the name and id
     * ID is used to connect the asset to the custodian
     * Name is used to create the note
     */
    const { id: custodianId, name: custodianName } = custodian;

    // Validate that the custodian belongs to the same organization
    const custodianTeamMember = await getTeamMember({
      id: custodianId,
      organizationId,
      select: {
        id: true,
        name: true,
        userId: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId, assetId, custodianId },
        label: "Assets",
        status: 404,
      });
    });

    const custodianDisplayName =
      custodianTeamMember.name?.trim() || custodianName.trim();

    if (isSelfService && custodianTeamMember.userId !== user.id) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message: "Self user can only assign custody to themselves only.",
        additionalData: { userId, assetId, custodianId },
        label: "Assets",
      });
    }

    /** In order to do it with a single query
     * 1. We update the asset status
     * 2. We create a new custody record for that specific asset
     * 3. We link it to the custodian
     */
    const asset = await db.asset
      .update({
        where: { id: assetId, organizationId } as Prisma.AssetWhereUniqueInput,
        data: {
          status: AssetStatus.IN_CUSTODY,
          custody: {
            create: {
              custodian: { connect: { id: custodianId } },
            },
          },
        },
        select: {
          id: true,
          title: true,
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
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const custodianDisplay = wrapCustodianForNote({
      teamMember: {
        name: custodianDisplayName,
        user: custodianTeamMember.user
          ? {
              id: custodianTeamMember.user.id,
              firstName: custodianTeamMember.user.firstName,
              lastName: custodianTeamMember.user.lastName,
            }
          : null,
      },
    });

    const content = isSelfService
      ? `${actor} took custody.`
      : `${actor} assigned custody to ${custodianDisplay}.`;

    await createNote({
      content,
      type: "UPDATE",
      userId: userId,
      assetId: asset.id,
    });

    sendNotification({
      title: `‘${asset.title}’ is now in custody of ${custodianDisplayName}`,
      message:
        "Remember, this asset will be unavailable until custody is manually released.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/assets/${assetId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const { asset, teamMembers } = useLoaderData<typeof loader>();
  const firstReservedBookingId = asset?.bookings?.[0]?.id;
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const zo = useZorm("BulkAssignCustody", AssignCustodySchema);
  const { isSelfService } = useUserRoleHelper();
  const error = zo.errors.custodian()?.message || actionData?.error?.message;

  return (
    <>
      <Form method="post" ref={zo.ref}>
        <div className="modal-content-wrapper">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
            <UserIcon />
          </div>
          <div className="mb-5">
            <h4>{isSelfService ? "Take" : "Assign"} custody of asset</h4>
            <p>
              This asset is currently available. You’re about to assign custody
              to {isSelfService ? "yourself" : "one of your team members"}.
            </p>
          </div>
          <div className="relative z-50 mb-8">
            <DynamicSelect
              hidden={isSelfService}
              defaultValue={
                isSelfService
                  ? JSON.stringify({
                      id: teamMembers[0].id,
                      name: resolveTeamMemberName(teamMembers[0]),
                    })
                  : undefined
              }
              disabled={disabled || isSelfService}
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
              showSearch={!isSelfService}
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
          {error ? (
            <div className="-mt-8 mb-8 text-sm text-error-500">{error}</div>
          ) : null}

          {firstReservedBookingId ? (
            <WarningBox className="-mt-4 mb-8">
              <>
                Asset is part of an{" "}
                <Link
                  to={`/bookings/${firstReservedBookingId}`}
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
