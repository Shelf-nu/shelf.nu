import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation } from "@remix-run/react";
import { useZorm } from "react-zorm";
import z from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import {
  Select,
  SelectGroup,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectValue,
  SelectTrigger,
} from "~/components/forms/select";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { useCurrentOrganization } from "~/hooks/use-current-organization-id";
import { createInvite } from "~/modules/invite/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, parseData } from "~/utils/http.server";
import { validEmail } from "~/utils/misc";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";
import { tw } from "~/utils/tw";
import type { UserFriendlyRoles } from "./settings.team";

const InviteUserFormSchema = z.object({
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(validEmail, () => ({
      message: "Please enter a valid email",
    })),
  teamMemberId: z.string().optional(),
  role: z.nativeEnum(OrganizationRoles),
});

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });

    await assertUserCanInviteUsersToWorkspace({ organizationId });

    return json(
      data({
        showModal: true,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
};

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });

    const { email, teamMemberId, role } = parseData(
      await request.formData(),
      InviteUserFormSchema
    );

    let teamMemberName = email.split("@")[0];

    if (teamMemberId) {
      const teamMember = await db.teamMember
        .findUnique({
          where: { deletedAt: null, id: teamMemberId },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to get team member",
            additionalData: { teamMemberId, userId },
            label: "Team",
          });
        });

      if (teamMember) {
        teamMemberName = teamMember.name;
      }
    }

    const existingInvites = await db.invite.findMany({
      where: {
        status: "PENDING",
        inviteeEmail: email,
        organizationId,
      },
    });

    if (existingInvites.length) {
      throw new ShelfError({
        cause: null,
        message:
          "User already has a pending invite. Either resend it or cancel it in order to be able to send a new one.",
        additionalData: { email, organizationId },
        label: "Invite",
        shouldBeCaptured: false,
      });
    }

    const invite = await createInvite({
      organizationId,
      inviteeEmail: email,
      inviterId: userId,
      roles: [role],
      teamMemberName,
      teamMemberId,
      userId,
    });

    if (invite) {
      sendNotification({
        title: "Successfully invited user",
        message:
          "They will receive an email in which they can complete their registration.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return redirect("/settings/team/users");
    }

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, {});
    return json(error(reason), { status: reason.status });
  }
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}
export const handle = {
  name: "settings.team.users.invite-user",
};

const organizationRolesMap: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.BASE]: "Base",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};

export default function InviteUser() {
  const organization = useCurrentOrganization();
  const zo = useZorm("NewQuestionWizardScreen", InviteUserFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const [searchParams] = useSearchParams();
  const teamMemberId = searchParams.get("teamMemberId");

  const actionData = useActionData<typeof action>();
  return organization ? (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 mr-3 inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
          <UserIcon />
        </div>
        <div className="mb-5">
          <h4>Invite team members</h4>
          <p>
            Invite a user to this workspace. Make sure to give them the proper
            role.
          </p>
        </div>
        <Form method="post" className="flex flex-col gap-3" ref={zo.ref}>
          {teamMemberId ? (
            <input type="hidden" name="teamMemberId" value={teamMemberId} />
          ) : null}
          <SelectGroup>
            <SelectLabel className="pl-0">Workspace</SelectLabel>
            <Select name="organizationId" defaultValue={organization.id}>
              <div className="flex h-10 w-full items-center justify-between truncate rounded-md border border-gray-300 bg-transparent px-3.5 py-3 text-[16px] text-gray-500 placeholder:text-gray-500 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-25 focus:ring-offset-2 disabled:opacity-50  [&_span]:max-w-full [&_span]:truncate">
                <SelectValue />
              </div>
              <SelectContent
                position="popper"
                className="w-full min-w-[300px] max-w-full"
                align="start"
              >
                <div className=" max-h-[320px] overflow-auto ">
                  <SelectItem
                    value={organization.id}
                    key={organization.id}
                    className="p-2"
                  >
                    <div className="flex max-w-full items-center gap-2 truncate">
                      <Image
                        imageId={organization.imageId}
                        alt="img"
                        className={tw("size-6 rounded-[2px] object-cover")}
                      />

                      <div className=" ml-px max-w-full truncate text-sm text-gray-900">
                        {organization.name}
                      </div>
                    </div>
                  </SelectItem>
                </div>
              </SelectContent>
            </Select>
          </SelectGroup>

          <SelectGroup>
            <SelectLabel className="pl-0">Role</SelectLabel>
            <Select name="role">
              <SelectTrigger>
                <SelectValue placeholder="Select user role" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="w-full min-w-[300px]"
                align="start"
              >
                <div className=" max-h-[320px] overflow-auto">
                  {Object.entries(organizationRolesMap).map(([k, v]) => (
                    <SelectItem value={k} key={k} className="p-2">
                      <div className="flex items-center gap-2">
                        <div className=" ml-px block text-sm lowercase text-gray-900 first-letter:uppercase">
                          {v}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </div>
              </SelectContent>
            </Select>
          </SelectGroup>

          <div className="pt-1.5">
            <Input
              name={zo.fields.email()}
              type="email"
              autoComplete="email"
              disabled={disabled}
              error={zo.errors.email()?.message}
              icon="mail"
              label={"Email address"}
              placeholder="rick@rolled.com"
              required
            />
          </div>

          {actionData?.error ? (
            <div className="text-sm text-error-500">
              {actionData.error.message}
            </div>
          ) : null}

          <div className="mt-7 flex gap-1">
            <Button
              variant="secondary"
              to=".."
              size="sm"
              width="full"
              disabled={disabled}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" width="full" disabled={disabled}>
              Send Invite
            </Button>
          </div>
        </Form>
      </div>
    </>
  ) : null;
}
