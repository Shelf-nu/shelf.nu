import { useMemo, useState } from "react";
import type { Prisma } from "@prisma/client";
import {
  AssetStatus,
  BookingStatus,
  OrganizationRoles,
  TemplateType,
} from "@prisma/client";
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
import TemplateSelect from "~/components/custody/template-select";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { Switch } from "~/components/forms/switch";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { CustomTooltip } from "~/components/shared/custom-tooltip";
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
      email: z.string(),
      userId: z.string(),
    })
  ),
});

const CustodianWithTemplateSchema = z.object({
  ...CustodianOnlySchema.shape,
  template: stringToJSONSchema.pipe(
    z.object({
      id: z.string(),
    })
  ),
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

    // We need to fetch all the templates that belong to the user's current organization
    // and the template type is CUSTODY
    const templates = await db.template.findMany({
      where: {
        organizationId,
        type: TemplateType.CUSTODY,
      },
    });

    const totalTeamMembers = await db.teamMember.count({ where });

    return json(
      data({
        showModal: true,
        teamMembers,
        asset,
        templates,
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
    const { role } = await requirePermission({
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

    /** We send the data from the form as a json string, so we can easily have both the name and id
     * ID is used to connect the asset to the custodian
     * Name is used to create the note
     */
    const {
      id: custodianId,
      name: custodianName,
      email: custodianEmail,
      userId: custodianUserId,
    } = custodian;

    let templateId = null,
      templateObj = null;

    if (addTemplateEnabled) {
      const template = (parsedData as any).template;
      templateId = template.id;

      templateObj = await db.template
        .findUnique({
          where: { id: templateId as string },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while fetching template. Please try again or contact support.",
            additionalData: { userId, assetId, custodianId },
            label: "Assets",
          });
        });

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

      /** In order to do it with a single query
       * 1. We update the asset status
       * 2. We create a new custody record for that specific asset
       * 3. We link it to the custodian
       */
      await db.asset
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

      if (!templateObj)
        throw new ShelfError({
          message:
            "Template not found. Please refresh and if the issue persists contact support.",
          label: "Assets",
          cause: null,
        });
    }

    let asset = null;

    if (addTemplateEnabled) {
      /**
       * In this case, we do the following:
       * 1. We check if the signature is required by the template
       * 2. If yes, the the asset status is "AVAILABLE", else "IN_CUSTODY"
       * 3. We create a new custody record for that specific asset and the template
       * 4. We link it to the custodian
       */
      asset = await db.asset
        .update({
          where: { id: assetId },
          data: {
            status: templateObj!.signatureRequired
              ? AssetStatus.AVAILABLE
              : AssetStatus.IN_CUSTODY,
            custody: {
              create: {
                custodian: { connect: { id: custodianId as string } },
                template: { connect: { id: templateId as string } },
                associatedTemplateVersion: templateObj!.lastRevision,
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
            additionalData: { userId, assetId, custodianId, templateId },
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
            additionalData: { userId, assetId, custodianId, templateId },
            label: "Assets",
          });
        });
    }

    // If the template was specified, and signature was required
    if (addTemplateEnabled && templateObj!.signatureRequired) {
      /** We create the note */
      await createNote({
        content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName?.trim()}** custody over **${asset.title?.trim()}**. **${custodianName?.trim()}** needs to sign the **${templateObj!.name?.trim()}** template before receiving custody.`,
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

      /** @TODO I have set this to void but we have to consider if we want to catch this */
      sendEmail({
        to: custodianEmail,
        subject: `You have been assigned custody over ${asset.title}.`,
        text: assetCustodyAssignedWithTemplateEmailText({
          assetName: asset.title,
          assignerName: user.firstName + " " + user.lastName,
          assetId: asset.id,
          templateId: templateObj!.id,
          assigneeId: custodianUserId,
        }),
      });
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

      /** @TODO I have set this to void but we have to consider if we want to catch this */
      void sendEmail({
        to: custodianEmail,
        subject: `You have been assigned custody over ${asset.title}`,
        text: assetCustodyAssignedEmailText({
          assetName: asset.title,
          assignerName: user.firstName + " " + user.lastName,
          assetId: asset.id,
        }),
      });
    }

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
  const { asset, teamMembers, templates } = useLoaderData<typeof loader>();
  const hasBookings = (asset?.bookings?.length ?? 0) > 0 || false;
  const hasTemplates = templates.length > 0;
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const actionData = useActionData<typeof action>();

  const [selectedCustodyUser, setSelectedCustodyUser] = useState<{
    id: string;
    userId: string | null;
    name: string;
  } | null>(null);

  const selectedCustodianHasUser = useMemo(
    () => selectedCustodyUser?.userId !== null,
    [selectedCustodyUser]
  );

  const shouldDisableSwitch = useMemo(
    () => selectedCustodyUser === null || !selectedCustodianHasUser,
    [selectedCustodyUser, selectedCustodianHasUser]
  );

  const [addTemplateEnabled, setAddTemplateEnabled] = useState(false);
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
              allowClear={false}
              closeOnSelect
              showSearch={!isSelfService}
              renderItem={(item) => resolveTeamMemberName(item, true)}
              transformItem={(item) => ({
                ...item,
                id: JSON.stringify({
                  id: item.id,
                  //If there is a user, we use its name, otherwise we use the name of the team member
                  name: resolveTeamMemberName(item),
                  userId: item?.userId,
                  email: item?.user?.email,
                }),
              })}
              onChange={(value) => {
                if (!value) {
                  return;
                }

                const id = JSON.parse(value).id;
                /**
                 * When the value passed is the same as the current value,
                 * that means the user is clicking the already selected item to disable it.
                 * So we clear the state in that case*/
                if (id === selectedCustodyUser?.id) {
                  setSelectedCustodyUser(null);
                  setAddTemplateEnabled(false);
                } else {
                  setSelectedCustodyUser(JSON.parse(value));
                }
              }}
            />
          </div>
          {shouldDisableSwitch ? (
            <div className="flex gap-x-2">
              <CustomTooltip
                content={
                  <TooltipContent
                    title={
                      selectedCustodianHasUser
                        ? "Please select a custodian"
                        : "Custodian needs to be a registered user"
                    }
                    message={
                      selectedCustodianHasUser
                        ? "You need to select a custodian before you can add a PDF template."
                        : "Signing PDFs is not allowed for NRM and non-users."
                    }
                  />
                }
              >
                <Switch required={false} disabled={true} />
              </CustomTooltip>
              <PdfSwitchLabel hasTemplates={hasTemplates} />
            </div>
          ) : (
            <div className="mb-5 flex gap-x-2">
              <Switch
                onClick={() => setAddTemplateEnabled((prev) => !prev)}
                defaultChecked={addTemplateEnabled}
                required={false}
                disabled={disabled}
              />
              <input
                type="hidden"
                name="addTemplateEnabled"
                value={addTemplateEnabled.toString()}
              />
              <PdfSwitchLabel hasTemplates={hasTemplates} />
            </div>
          )}

          {addTemplateEnabled && (
            <div className="mt-5">
              <TemplateSelect />
              {/* @TODO this still needs to be updated with the new approach. This check wont work as this type is not passed to action data */}
              {/* {actionData?.type && actionData?.type === "TEMPLATE" && (
                <div className="text-sm text-error-500">{actionData.error}</div>
              )} */}
            </div>
          )}

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
                . You will not be able to check-out your booking if this asset
                has custody.
              </>
            </WarningBox>
          ) : null}

          <div className="mt-8 flex gap-3">
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
              disabled={
                disabled ||
                selectedCustodyUser === null ||
                selectedCustodyUser?.userId === null
              }
            >
              Confirm
            </Button>
          </div>
        </div>
      </Form>
    </>
  );
}

function TooltipContent({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div>
      <div>
        <div className="text-md mb-2 font-semibold text-gray-700">{title}</div>
        <div className="text-sm text-gray-500">{message}</div>
      </div>
    </div>
  );
}

const PdfSwitchLabel = ({ hasTemplates }: { hasTemplates: boolean }) => (
  <div className="flex flex-col gap-y-1">
    <div className="text-md font-semibold text-gray-600">Add PDF Template</div>
    <p className="text-sm text-gray-500">
      {hasTemplates
        ? "Custodian needs to read (and sign) a document before receiving custody."
        : "You need to create templates before you can add them here."}
      {hasTemplates ? (
        <Link className="text-gray-700 underline" to="#">
          Learn more
        </Link>
      ) : (
        <Link className="text-gray-700 underline" to="/settings/template/new">
          Create a template
        </Link>
      )}
    </p>
  </div>
);
