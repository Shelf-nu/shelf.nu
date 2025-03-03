import { useState } from "react";
import type { CustodyAgreement, Prisma } from "@prisma/client";
import { AssetStatus, BookingStatus, OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import CustodyAgreementSelector from "~/components/custody/custody-agreement-selector";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { WarningBox } from "~/components/shared/warning-box";

import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { AssignCustodySchema } from "~/modules/custody/schema";
import {
  assetCustodyAssignedEmailText,
  assetCustodyAssignedWithTemplateEmailText,
} from "~/modules/invite/helpers";
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

const DiscriminatorSchema = z.object({
  addTemplateEnabled: z
    .string()
    .transform((value) => (value === "true" ? true : false)),
});

const CustodianOnlySchema = z.object({
  custodian: stringToJSONSchema.pipe(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email().optional(),
    })
  ),
});

const CustodianWithTemplateSchema = z.object({
  ...CustodianOnlySchema.shape,
  template: z.string().min(1, "Template is required."),
});

const getSchema = (addTemplateEnabled: boolean) =>
  addTemplateEnabled ? CustodianWithTemplateSchema : CustodianOnlySchema;

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
    const { role, organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    const formData = await request.formData();

    const { addTemplateEnabled } = parseData(formData, DiscriminatorSchema, {
      additionalData: { userId, assetId },
      message: "Internal error. Please try again or contact support.",
    });

    const parsedData = parseData(formData, getSchema(addTemplateEnabled), {
      additionalData: { userId, assetId },
      message: "Error while parsing data.",
    });

    const { custodian } = parsedData;
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

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

    let custodyAgreement: CustodyAgreement | null = null;

    if (addTemplateEnabled) {
      const templateId = (parsedData as any).template;

      custodyAgreement = await db.custodyAgreement
        .findUnique({ where: { id: templateId as string } })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while fetching template. Please try again or contact support.",
            additionalData: { userId, assetId, custodianId },
            label: "Assets",
          });
        });

      if (!custodyAgreement)
        throw new ShelfError({
          message:
            "Template not found. Please refresh and if the issue persists contact support.",
          label: "Assets",
          cause: null,
        });
    }

    let asset = null;

    if (custodyAgreement) {
      /**
       * In this case, we do the following:
       * 1. We check if the signature is required by the template
       * 2. If yes, the the asset status is "AVAILABLE", else "IN_CUSTODY"
       * 3. We create a new custody record for that specific asset and the template
       * 4. We link it to the custodian
       */
      asset = await db.asset
        .update({
          where: { id: assetId, organizationId },
          data: {
            status: custodyAgreement!.signatureRequired
              ? AssetStatus.AVAILABLE
              : AssetStatus.IN_CUSTODY,
            custody: {
              create: {
                custodian: { connect: { id: custodianId } },
                agreement: { connect: { id: custodyAgreement.id } },
                associatedAgreementVersion: custodyAgreement!.lastRevision,
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
            additionalData: {
              userId,
              assetId,
              custodianId,
              templateId: custodyAgreement.id,
            },
            label: "Assets",
          });
        });
    } else {
      /** In order to do it with a single query
       * 1. We update the asset status
       * 2. We create a new custody record for that specific asset
       * 3. We link it to the custodian
       */
      asset = await db.asset
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
    }

    // If the template was specified, and signature was required
    if (addTemplateEnabled && custodyAgreement?.signatureRequired) {
      /** We create the note */
      await createNote({
        content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName?.trim()}** custody over **${asset.title?.trim()}**. **${custodianName?.trim()}** needs to sign the **${custodyAgreement!.name?.trim()}** template before receiving custody.`,
        type: "UPDATE",
        userId: userId,
        assetId: asset.id,
      });

      sendNotification({
        title: `‘${asset.title}’ would go in custody of ${custodianName}`,
        message:
          "This asset will stay available until the custodian signs the PDF template. After that, the asset will be unavailable until custody is manually released.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      /** Once the asset is updated, we create the note */
      await createNote({
        content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has ${
          isSelfService ? "taken" : `given **${custodianName.trim()}**`
        } custody over **${asset.title.trim()}**`,
        type: "UPDATE",
        userId: userId,
        assetId: asset.id,
      });

      /** If there is no email, then custodian is NRM */
      if (custodianEmail) {
        sendEmail({
          to: custodianEmail,
          subject: `You have been assigned custody over ${asset.title}.`,
          text: assetCustodyAssignedWithTemplateEmailText({
            assetName: asset.title,
            assignerName: user.firstName + " " + user.lastName,
            assetId: asset.id,
            templateId: custodyAgreement!.id,
            assigneeId: custodianId,
          }),
        });
      }
    } else {
      // If the template was not specified
      await createNote({
        content: `**${user.firstName} ${user.lastName}** has given **${custodianName}** custody over **${asset.title}**`,
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
      custodyAgreement
        ? `/assets/${assetId}/overview/share-template`
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
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const actionData = useActionData<typeof action>();
  const zo = useZorm("BulkAssignCustody", AssignCustodySchema);
  const { isSelfService } = useUserRoleHelper();
  const [hasCustodianSelected, setHasCustodianSelected] = useState(false);

  const error = zo.errors.custodian()?.message || actionData?.error?.message;

  const hasBookings = (asset?.bookings?.length ?? 0) > 0 || false;

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
