import { useState } from "react";
import type { CustodyAgreement, Prisma } from "@prisma/client";
import {
  AssetStatus,
  BookingStatus,
  CustodySignatureStatus,
  CustodyStatus,
  KitStatus,
  OrganizationRoles,
} from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import CustodyAgreementSelector from "~/components/custody/custody-agreement-selector";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { AlertIcon, UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { WarningBox } from "~/components/shared/warning-box";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { AssignCustodySchema } from "~/modules/custody/schema";
import { kitCustodyAssignedWithAgreementEmailText } from "~/modules/kit/emais";
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

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: {
      userId,
    },
  });

  try {
    const { organizationId, role, userOrganizations } = await requirePermission(
      {
        userId,
        request,
        entity: PermissionEntity.kit,
        action: PermissionAction.custody,
      }
    );

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
      userOrganizations,
      request,
    });

    const someAssetsCheckedOut = kit.assets.some(
      (asset) => asset.status === AssetStatus.CHECKED_OUT
    );
    if (someAssetsCheckedOut) {
      throw new ShelfError({
        cause: null,
        label: "Kit",
        message:
          "Cannot assign custody to kit because some of it's assets are checked out.",
      });
    }

    if (kit.custody) {
      return redirect(`/kits/${kitId}`);
    }

    const searchParams = getCurrentSearchParams(request);

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
          label: "Kit",
        });
      });

    const totalTeamMembers = await db.teamMember.count({ where });

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

    const { role, organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.custody,
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const { custodian, agreement } = parseData(
      await request.formData(),
      AssignCustodySchema,
      {
        additionalData: { userId, kitId },
        message: "Please select a team member",
      }
    );

    const { id: custodianId, name: custodianName } = custodian;

    const user = await getUserByID(userId);

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
          additionalData: { userId, kitId, custodianId },
          label: "Kit",
        });
      }
    }

    let agreementFound: Pick<
      CustodyAgreement,
      "id" | "name" | "signatureRequired"
    > | null = null;

    /** Find and validate the agreement if it is provided by user */
    if (agreement) {
      agreementFound = await db.custodyAgreement
        .findUniqueOrThrow({
          where: { id: agreement, organizationId },
          select: { id: true, name: true, signatureRequired: true },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Could not find find the agreement, are you sure it exists in the current workspace.",
            label: "Kit",
          });
        });
    }

    const kitFound = await db.kit
      .findUniqueOrThrow({
        where: { id: kitId, organizationId },
        select: {
          id: true,
          assets: {
            select: {
              id: true,
              title: true,
              status: true,
              custody: { select: { id: true } },
              custodyReceipts: {
                where: { custodyStatus: CustodyStatus.ACTIVE },
                select: {
                  id: true,
                  signatureStatus: true,
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label: "Kit",
          message:
            "Kit not found, are you sure it exists in the current workspace?",
        });
      });

    const someAssetsCheckedOut = kitFound.assets.some(
      (asset) => asset.status === AssetStatus.CHECKED_OUT
    );
    if (someAssetsCheckedOut) {
      throw new ShelfError({
        cause: null,
        label: "Kit",
        message:
          "Cannot assign custody to kit because some of it's assets are checked out",
      });
    }

    const assetCustodies = kitFound.assets
      .map((asset) => asset.custody?.id)
      .filter(Boolean) as string[];

    const assetCustodyReceipts = kitFound.assets.flatMap(
      (asset) => asset.custodyReceipts
    );

    const updatedKit = await db.$transaction(async (tx) => {
      const kit = await tx.kit.update({
        where: { id: kitId },
        data: {
          status: agreementFound?.signatureRequired
            ? KitStatus.SIGNATURE_PENDING
            : KitStatus.IN_CUSTODY,
          custody: {
            create: {
              custodian: { connect: { id: custodian.id } },
              /**
               * If agreement requires a signature then signature status is PENDING
               * otherwise signature status is NOT_REQUIRED
               */
              signatureStatus: agreementFound?.signatureRequired
                ? CustodySignatureStatus.PENDING
                : CustodySignatureStatus.NOT_REQUIRED,
              agreement: agreementFound
                ? { connect: { id: agreementFound.id } }
                : undefined,
            },
          },
        },
        include: { custody: { select: { id: true } } },
      });

      /**
       * If there are some custodies over assets, then we have to remove them
       * then we can create the new custodies over them.
       */
      if (assetCustodies.length > 0) {
        await tx.custody.deleteMany({
          where: { id: { in: assetCustodies } },
        });
      }

      /* We also have to update all the asset active custody receipts */
      for (const receipt of assetCustodyReceipts) {
        await tx.custodyReceipt.update({
          where: { id: receipt.id },
          data: {
            custodyStatus:
              receipt.signatureStatus === CustodySignatureStatus.SIGNED ||
              receipt.signatureStatus === CustodySignatureStatus.NOT_REQUIRED
                ? CustodyStatus.FINISHED
                : CustodyStatus.CANCELLED,
            signatureStatus:
              receipt.signatureStatus === CustodySignatureStatus.PENDING
                ? CustodySignatureStatus.CANCELLED
                : undefined,
          },
        });
      }

      /** Creating custodies over assets */
      await tx.custody.createMany({
        data: kitFound.assets.map((asset) => ({
          teamMemberId: custodian.id,
          /**
           * If agreement requires a signature then signature status is PENDING
           * otherwise signature status is NOT_REQUIRED
           */
          signatureStatus: agreementFound?.signatureRequired
            ? CustodySignatureStatus.PENDING
            : CustodySignatureStatus.NOT_REQUIRED,
          agreementId: agreementFound ? agreementFound.id : undefined,
          assetId: asset.id,
        })),
      });

      /** Updating the status of assets */
      await tx.asset.updateMany({
        where: { id: { in: kitFound.assets.map((asset) => asset.id) } },
        data: {
          status: agreementFound?.signatureRequired
            ? AssetStatus.SIGNATURE_PENDING
            : AssetStatus.IN_CUSTODY,
        },
      });

      /** Create Receipt for custody */
      await tx.custodyReceipt.create({
        data: {
          kitId: kit.id,
          custodianId,
          organizationId,
          agreementId: agreementFound?.id,
          signatureStatus: agreementFound?.signatureRequired
            ? CustodySignatureStatus.PENDING
            : CustodySignatureStatus.NOT_REQUIRED,
        },
      });

      /* Create notes for all assets in kit */
      await tx.note.createMany({
        data: kitFound.assets.map((asset) => ({
          content: agreementFound?.signatureRequired
            ? `**${user.firstName?.trim()} ${user.lastName?.trim()}** has ${
                isSelfService ? "taken" : `given **${custodianName.trim()}**`
              } custody over **${asset.title.trim()}**. **${custodianName?.trim()}** needs to sign the **${agreementFound.name?.trim()}** agreement before receiving custody.`
            : `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName.trim()}** custody over **${asset.title.trim()}** via Kit assignment **[${
                kit.name
              }](/kits/${kit.id})**`,
          type: "UPDATE" as const,
          userId,
          assetId: asset.id,
        })),
      });

      return kit;
    });

    if (agreementFound) {
      if (custodian.email) {
        sendEmail({
          to: custodian.email,
          subject: `You have been assigned custody over ${updatedKit.name}.`,
          text: kitCustodyAssignedWithAgreementEmailText({
            kitName: updatedKit.name,
            assignerName: `${user.firstName} ${user.lastName}`,
            kitId,
            custodyId: updatedKit?.custody?.id ?? "",
            signatureRequired: agreementFound.signatureRequired,
          }),
        });
      }

      if (agreementFound.signatureRequired) {
        sendNotification({
          title: `'${updatedKit.name}' would go in custody of ${custodianName}`,
          message:
            "This kit will stay available until the custodian signs the PDF agreement. After that, the asset will be unavailable until custody is manually released.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
      }
    } else {
      sendNotification({
        title: `‘${updatedKit.name}’ is now in custody of ${custodianName}`,
        message:
          "Remember, this kit will be unavailable until it is manually checked in.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });
    }

    return redirect(`/kits/${kitId}/assets`);
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
  const { kit, teamMembers } = useLoaderData<typeof loader>();
  const [hasCustodianSelected, setHasCustodianSelected] = useState(false);
  const submit = useSubmit();

  const [isAlertOpen, setIsAlertOpen] = useState(false);

  const { isSelfService } = useUserRoleHelper();

  const hasBookings = kit.assets.some((asset) => asset.bookings.length > 0);
  const zo = useZorm("BulkAssignCustody", AssignCustodySchema);
  const error = zo.errors.custodian()?.message || actionData?.error?.message;

  const someAssetsUnavailable = kit.assets.some(
    (asset) => asset.status !== "AVAILABLE"
  );

  function showAlert() {
    setIsAlertOpen(true);
  }

  function hideAlert() {
    setIsAlertOpen(false);
  }

  function handleSubmit() {
    if (zo.form) {
      submit(zo.form);
      hideAlert();
    }
  }

  return (
    <Form method="post" ref={zo.ref}>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
          <UserIcon />
        </div>

        <div className="mb-5">
          <h4>{isSelfService ? "Take" : "Assign"} custody of kit</h4>
          <p>
            This kit is currently available. You're about to assign custody to{" "}
            {isSelfService ? "yourself" : "one of your team members"}. All the
            assets in this kit will also be assigned the same custody.
          </p>
        </div>

        <div className="relative z-50 mb-8">
          <DynamicSelect
            hidden={isSelfService}
            showSearch={!isSelfService}
            disabled={disabled || isSelfService}
            defaultValue={
              isSelfService
                ? JSON.stringify({
                    id: teamMembers[0].id,
                    name: resolveTeamMemberName(teamMembers[0]),
                  })
                : undefined
            }
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
                email: item.user?.email,
              }),
            })}
            renderItem={(item) => resolveTeamMemberName(item, true)}
            onChange={(value) => {
              setHasCustodianSelected(!!value);
            }}
          />
        </div>

        <CustodyAgreementSelector
          className="my-5"
          hasCustodianSelected={hasCustodianSelected}
        />

        {error ? (
          <div className="mb-8 text-sm text-error-500">{error}</div>
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

        <When truthy={someAssetsUnavailable}>
          <WarningBox className="mb-4">
            The kit already has some assets in custody. By assigning custody to
            the kit, the asset custody will be synchronized with the kit. All
            current custody or pending custody of the assets will be released
            and they will get assigned custody via the kit.
          </WarningBox>
        </When>

        <div className="flex gap-3">
          <Button to=".." variant="secondary" width="full" disabled={disabled}>
            Cancel
          </Button>

          {someAssetsUnavailable ? (
            <AlertDialog open={isAlertOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="primary"
                  width="full"
                  disabled={disabled}
                  onClick={() => {
                    const validation = zo.validate();
                    if (validation.success) {
                      showAlert();
                    }
                  }}
                >
                  Confirm
                </Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <div className="mx-auto md:m-0">
                    <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
                      <AlertIcon />
                    </span>
                  </div>
                  <AlertDialogTitle>
                    Confirm custody assignment
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Some of the assets in this kit already have custody. By
                    assigning custody to the kit, the asset custody will be
                    synchronized with the kit.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button
                      onClick={hideAlert}
                      variant="secondary"
                      disabled={disabled}
                    >
                      Cancel
                    </Button>
                  </AlertDialogCancel>

                  <AlertDialogAction asChild>
                    <Button onClick={handleSubmit} disabled={disabled}>
                      Confirm
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              variant="primary"
              width="full"
              type="submit"
              disabled={disabled}
            >
              Confirm
            </Button>
          )}
        </div>
      </div>
    </Form>
  );
}
