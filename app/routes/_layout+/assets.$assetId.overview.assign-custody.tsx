import { useState } from "react";
import type { CustodyAgreement, Prisma } from "@prisma/client";
import {
  AssetStatus,
  BookingStatus,
  CustodySignatureStatus,
  OrganizationRoles,
} from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useActionData, useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import CustodyAgreementSelector from "~/components/custody/custody-agreement-selector";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { WarningBox } from "~/components/shared/warning-box";

import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  assetCustodyAssignedEmailText,
  assetCustodyAssignedWithAgreementEmailText,
} from "~/modules/invite/helpers";
import { createNote } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
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
import type { AssetWithBooking } from "./bookings.$bookingId.manage-assets";

const AssignCustodySchema = z.object({
  custodian: stringToJSONSchema.pipe(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email().optional(),
    })
  ),
  agreement: z.string().optional(),
});

export async function loader({ context, request, params }: LoaderFunctionArgs) {
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

    const asset = await db.asset
      .findUnique({
        where: { id: assetId, organizationId },
        select: {
          kitId: true,
          custody: { select: { id: true } },
          bookings: {
            where: { status: { in: [BookingStatus.RESERVED] } },
            select: { id: true },
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
    const where = {
      deletedAt: null,
      organizationId,
      userId: role === OrganizationRoles.SELF_SERVICE ? userId : undefined,
    } satisfies Prisma.TeamMemberWhereInput;

    const teamMembers = await db.teamMember
      .findMany({
        where,
        include: { user: true },
        orderBy: { userId: "asc" },
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
    const { role, organizationId, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.custody,
      });

    const formData = await request.formData();

    const { custodian, agreement } = parseData(formData, AssignCustodySchema, {
      additionalData: { userId, assetId },
      message: "Error while parsing data.",
    });

    const user = await getUserByID(userId);

    /**
     * We send the data from the form as a json string, so we can easily have both the name and id
     * ID is used to connect the asset to the custodian
     * Name is used to create the note
     */
    const {
      id: custodianId,
      name: custodianName,
      email: custodianEmail,
    } = custodian;

    /**
     * Validate SELF_SERVICE user custody
     * Self service users are allowed to assign custody to themselves only
     * */
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;
    if (isSelfService) {
      const custodian = await db.teamMember.findUnique({
        where: { id: custodianId },
        select: { id: true, userId: true },
      });

      if (custodian?.userId !== user.id) {
        throw new ShelfError({
          cause: null,
          title: "Action not allowed",
          message: "Self user can only assign custody to themselves only.",
          additionalData: { userId, assetId, custodianId },
          label: "Assets",
        });
      }
    }

    let agreementFound: Pick<
      CustodyAgreement,
      "id" | "name" | "signatureRequired"
    > | null = null;

    /** Find and validate the agreement if it is provided */
    if (agreement) {
      agreementFound = await db.custodyAgreement.findUnique({
        where: { id: agreement, organizationId },
        select: {
          id: true,
          name: true,
          signatureRequired: true,
        },
      });

      if (!agreementFound) {
        throw new ShelfError({
          cause: null,
          message:
            "Agreement not found. Please refresh and if the issue persists contact support.",
          label: "Assets",
        });
      }
    }

    /**
     * New approach for handling custodies:
     * Previously, we only deleted the custody, but with the introduction of the
     * Signing feature, we now need to track receipts.
     *
     * To achieve this, we follow these steps:
     * 1. Create a custody record.
     * 2. Update the asset status based on `signatureRequired`.
     * 3. Create a `CustodyReceipt` to track receipts.
     */
    const asset = await db.$transaction(async (tx) => {
      const updatedAsset = await tx.asset.update({
        where: { id: assetId, organizationId },
        data: {
          /**
           * If agreement requires a signature then asset will be with status SIGNATURE_PENDING until user signs the custody
           * otherwise it will be IN_CUSTODY directly
           */
          status: agreementFound?.signatureRequired
            ? AssetStatus.SIGNATURE_PENDING
            : AssetStatus.IN_CUSTODY,
          custody: {
            create: {
              custodian: { connect: { id: custodianId } },
              /**
               * If agreement requires a signature then signature status is PENDING
               * otherwise signature status is NOT_REQUIRED
               */
              signatureStatus: agreementFound?.signatureRequired
                ? CustodySignatureStatus.PENDING
                : CustodySignatureStatus.NOT_REQUIRED,
              ...(agreementFound
                ? {
                    agreement: { connect: { id: agreementFound.id } },
                  }
                : {}),
            },
          },
        },
        include: {
          custody: {
            select: {
              id: true,
              asset: { select: { id: true, title: true } },
            },
          },
        },
      });

      /** We also create CustodyReceipt */
      await tx.custodyReceipt.create({
        data: {
          assetId,
          custodianId,
          organizationId,
          agreementId: agreementFound?.id,
          signatureStatus: agreementFound?.signatureRequired
            ? CustodySignatureStatus.PENDING
            : CustodySignatureStatus.NOT_REQUIRED,
        },
      });

      return updatedAsset;
    });

    // If the agreement was specified, and signature was required
    if (agreementFound) {
      if (agreementFound.signatureRequired) {
        await createNote({
          content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has ${
            isSelfService ? "taken" : `given **${custodianName.trim()}**`
          } custody over **${asset.title.trim()}**. **${custodianName?.trim()}** needs to sign the **${agreementFound.name?.trim()}** agreement before receiving custody.`,
          type: "UPDATE",
          userId: userId,
          assetId: asset.id,
        });

        sendNotification({
          title: `'${asset.title}' would go in custody of ${custodianName}`,
          message:
            "This asset will stay available until the custodian signs the PDF agreement. After that, the asset will be unavailable until custody is manually released.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
      }

      /** If there is no email, then custodian is NRM */
      if (custodianEmail && asset?.custody?.id) {
        sendEmail({
          to: custodianEmail,
          subject: `You have been assigned custody over ${asset.title}.`,
          text: assetCustodyAssignedWithAgreementEmailText({
            assetName: asset.title,
            assignerName: user.firstName + " " + user.lastName,
            assetId: asset.id,
            custodyId: asset.custody.id,
            signatureRequired: agreementFound.signatureRequired,
            orgName: currentOrganization.name,
          }),
        });
      }
    } else {
      // If the agreement was not specified
      await createNote({
        content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has ${
          isSelfService ? "taken" : `given **${custodianName.trim()}**`
        } custody over **${asset.title.trim()}**`,
        type: "UPDATE",
        userId: userId,
        assetId: asset.id,
      });

      sendNotification({
        title: `'${asset.title}' is now in custody of ${custodianName}`,
        message:
          "Remember, this asset will be unavailable until custody is manually released.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      /** If there is no email, then custodian is NRM */
      if (custodianEmail) {
        sendEmail({
          to: custodianEmail,
          subject: `You have been assigned custody over ${asset.title}`,
          text: assetCustodyAssignedEmailText({
            assetName: asset.title,
            assignerName: user.firstName + " " + user.lastName,
            assetId: asset.id,
          }),
        });
      }
    }

    return redirect(
      agreementFound
        ? `/assets/${assetId}/overview/share-agreement`
        : `/assets/${assetId}/overview`
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const { asset, teamMembers } = useLoaderData<typeof loader>();
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  const zo = useZorm("AssignAssetCustody", AssignCustodySchema);
  const { isSelfService } = useUserRoleHelper();
  const [hasCustodianSelected, setHasCustodianSelected] =
    useState(isSelfService); // If self-service, we assume the custodian is already selected

  const error = zo.errors.custodian()?.message || actionData?.error?.message;

  const hasBookings = (asset?.bookings?.length ?? 0) > 0 || false;

  const isPartOfKit = !!asset?.kitId;

  return (
    <Form className="modal-content-wrapper" method="post" ref={zo.ref}>
      <div className="">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
          <UserIcon />
        </div>
        <div className="mb-5">
          <h4>{isSelfService ? "Take" : "Assign"} custody of asset</h4>
          <p>
            This asset is currently available. You’re about to assign custody to{" "}
            {isSelfService ? "yourself" : "one of your team members"}.
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
            allowClear={false}
            closeOnSelect
            showSearch={!isSelfService}
            renderItem={(item) => resolveTeamMemberName(item, true)}
            transformItem={(item) => ({
              ...item,
              id: JSON.stringify({
                id: item.id,
                name: resolveTeamMemberName(item),
                email: item?.user?.email,
              }),
            })}
            onChange={(value) => {
              setHasCustodianSelected(!!value);
            }}
          />
        </div>

        <CustodyAgreementSelector
          className="mt-5"
          hasCustodianSelected={!!hasCustodianSelected}
        />

        {error ? (
          <div className="-mt-8 mb-8 text-sm text-error-500">{error}</div>
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
              . You will not be able to check-out your booking if this asset has
              custody.
            </>
          </WarningBox>
        ) : null}

        <When truthy={isPartOfKit}>
          <WarningBox className="my-8">
            This asset is part of a kit. By assigning it individual custody, you
            might get some inconsistent information and face limitations when
            trying to update the kit custody later on.{" "}
            <Link
              to={`/kits/${asset?.kitId}/assets/assign-custody`}
              className="underline"
            >
              Assign kit custody
            </Link>
          </WarningBox>
        </When>

        <div className="mt-8 flex gap-3">
          <Button to=".." variant="secondary" width="full" disabled={disabled}>
            Cancel
          </Button>
          <Button
            variant="primary"
            width="full"
            type="submit"
            disabled={disabled || !hasCustodianSelected}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Form>
  );
}
