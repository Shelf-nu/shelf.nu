import { cloneElement, useCallback, useEffect, useState } from "react";
import { OrganizationRoles } from "@prisma/client";
import { UserIcon } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useCurrentOrganization } from "~/hooks/use-current-organization-id";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { UserFriendlyRoles } from "~/routes/_layout+/settings.team";
import { isFormProcessing } from "~/utils/form";
import { validEmail } from "~/utils/misc";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Image } from "../shared/image";
import When from "../when/when";

type InviteUserDialogProps = {
  className?: string;
  teamMemberId?: string;
  trigger?: React.ReactElement<{ onClick: () => void }>;
  open?: boolean;
  onClose?: () => void;
};

export const InviteUserFormSchema = z.object({
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(validEmail, () => ({
      message: "Please enter a valid email",
    })),
  teamMemberId: z.string().optional(),
  role: z.nativeEnum(OrganizationRoles, { message: "Please select a role." }),
});

const organizationRolesMap: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.BASE]: "Base",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};

export default function InviteUserDialog({
  className,
  trigger,
  teamMemberId,
  open = false,
  onClose,
}: InviteUserDialogProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const organization = useCurrentOrganization();

  const fetcher = useFetcherWithReset<{
    error?: { message?: string };
    success?: boolean;
  }>();

  const disabled = isFormProcessing(fetcher.state);

  const zo = useZorm("NewQuestionWizardScreen", InviteUserFormSchema);

  function openDialog() {
    setIsDialogOpen(true);
  }

  const closeDialog = useCallback(() => {
    zo.form?.reset();
    setIsDialogOpen(false);
    onClose && onClose();
  }, [onClose, zo.form]);

  useEffect(
    function handleSuccess() {
      if (fetcher.data?.success === true) {
        closeDialog();
        fetcher.reset();
      }
    },
    [closeDialog, fetcher, fetcher.data?.success]
  );

  if (!organization) {
    return null;
  }

  return (
    <>
      {trigger ? cloneElement(trigger, { onClick: openDialog }) : null}

      <DialogPortal>
        <Dialog
          className={className}
          title={
            <div className="mt-4 inline-flex items-center justify-center rounded-full border-4 border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
              <UserIcon />
            </div>
          }
          open={isDialogOpen || open}
          onClose={closeDialog}
        >
          <div className="px-6 py-4">
            <div className="mb-5">
              <h4>Invite team members</h4>
              <p>
                Invite a user to this workspace. Make sure to give them the
                proper role.
              </p>
            </div>

            <fetcher.Form
              ref={zo.ref}
              action="/api/settings/invite-user"
              method="post"
              className="flex flex-col gap-3"
            >
              {/* <input type="hidden" name="redirectTo" value={redirectTo} /> */}
              <When truthy={!!teamMemberId}>
                <input
                  type="hidden"
                  name="teamMemberId"
                  value={teamMemberId!}
                />
              </When>

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
                            className="size-6 rounded-[2px] object-cover"
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
              <When truthy={!!zo.errors.role()}>
                <p className="-mt-1 text-sm text-error-500">
                  {zo.errors?.role()?.message}
                </p>
              </When>

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

              <When truthy={!!fetcher?.data?.error}>
                <p className="text-sm text-error-500">
                  {fetcher.data?.error?.message}
                </p>
              </When>

              <div className="mt-7 flex gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  width="full"
                  disabled={disabled}
                  onClick={closeDialog}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  width="full"
                  disabled={disabled}
                >
                  Send Invite
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
