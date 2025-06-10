import {
  type Organization,
  type Currency,
  OrganizationType,
} from "@prisma/client";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, defaultValidateFileAtom } from "~/atoms/file";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader } from "~/routes/_layout+/account-details.workspace.$workspaceId.edit";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import CurrencySelector from "./currency-selector";
import FormRow from "../forms/form-row";
import { InnerLabel } from "../forms/inner-label";
import Input from "../forms/input";
import { Switch } from "../forms/switch";
import { CrispButton } from "../marketing/crisp";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

/** Pass props of the values to be used as default for the form fields */
interface Props {
  name?: Organization["name"];
  currency?: Organization["currency"];
  className?: string;
}

export const EditGeneralWorkspaceSettingsFormSchema = (
  personalOrg: boolean = false
) =>
  z.object({
    id: z.string(),
    name: personalOrg
      ? z.string().optional()
      : z.string().min(2, "Name is required"),
    logo: z.any().optional(),
    currency: z.custom<Currency>(),
  });

export const WorkspaceEditForms = ({ name, currency, className }: Props) => (
  <div className={tw("flex flex-col gap-3", className)}>
    <WorkspaceGeneralEditForms name={name} currency={currency} />
    <WorkspacePermissionsEditForm />
    <WorkspaceSSOEditForm />
  </div>
);

const WorkspaceGeneralEditForms = ({ name, currency, className }: Props) => {
  const { organization, isPersonalWorkspace } = useLoaderData<typeof loader>();

  let schema = EditGeneralWorkspaceSettingsFormSchema(isPersonalWorkspace);
  const zo = useZorm("NewQuestionWizardScreen", schema);
  const fetcher = useFetcher({ key: "general" });
  const disabled = useDisabled(fetcher);
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(defaultValidateFileAtom);
  const [, updateTitle] = useAtom(updateDynamicTitleAtom);

  return (
    <fetcher.Form
      ref={zo.ref}
      method="post"
      className="flex  flex-col gap-2"
      encType="multipart/form-data"
    >
      <Card className={tw("my-0", className)}>
        <div className="mb-6">
          <h3 className="text-text-lg font-semibold">General</h3>
          <p className="text-sm text-gray-600">
            Manage general workspace settings.
          </p>
        </div>
        <input type="hidden" value={organization.id} name="id" />

        <FormRow
          rowLabel={"Name"}
          className="border-b-0 pb-[10px] pt-0"
          required={zodFieldIsRequired(schema.shape.name)}
        >
          <Input
            label="Name"
            hideLabel
            name={zo.fields.name()}
            disabled={isPersonalWorkspace || disabled}
            error={zo.errors.name()?.message}
            autoFocus
            onChange={updateTitle}
            className="w-full"
            defaultValue={name || undefined}
            placeholder=""
            required={!isPersonalWorkspace}
          />
        </FormRow>

        <FormRow rowLabel={"Main image"} className="border-b-0">
          <div>
            <p className="hidden lg:block">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
            <Input
              // disabled={disabled}
              accept={ACCEPT_SUPPORTED_IMAGES}
              name="image"
              type="file"
              onChange={validateFile}
              label={"Main image"}
              hideLabel
              error={fileError}
              className="mt-2"
              inputClassName="border-0 shadow-none p-0 rounded-none"
            />
            <p className="mt-2 lg:hidden">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
          </div>
        </FormRow>

        <div>
          <FormRow
            rowLabel={"Currency"}
            className={"border-b-0"}
            subHeading={
              <p>
                Choose the currency for your workspace. If you don't see your
                currency, please{" "}
                <CrispButton variant="link" className="inline text-xs">
                  contact support
                </CrispButton>
                .
              </p>
            }
          >
            <InnerLabel hideLg>Currency</InnerLabel>
            <CurrencySelector
              defaultValue={currency || "USD"}
              name={zo.fields.currency()}
            />
          </FormRow>
        </div>
        <div className="text-right">
          <Button
            type="submit"
            disabled={disabled}
            value="general"
            name="intent"
          >
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Card>
    </fetcher.Form>
  );
};

export const EditWorkspacePermissionsSettingsFormSchema = () =>
  z.object({
    id: z.string(),
    selfServiceCanSeeCustody: z
      .string()
      .transform((val) => val === "on")
      .default("false"),
    selfServiceCanSeeBookings: z
      .string()
      .transform((value) => value === "on")
      .default("false"),
    baseUserCanSeeCustody: z
      .string()
      .transform((value) => value === "on")
      .default("false"),
    baseUserCanSeeBookings: z
      .string()
      .transform((value) => value === "on")
      .default("false"),
  });

const WorkspacePermissionsEditForm = ({ className }: Props) => {
  const { organization } = useLoaderData<typeof loader>();
  const fetcher = useFetcher({ key: "permissions" });
  let schema = EditWorkspacePermissionsSettingsFormSchema();
  const zo = useZorm("NewQuestionWizardScreen", schema);
  const disabled = useDisabled(fetcher);

  return organization.type === OrganizationType.TEAM ? (
    <fetcher.Form ref={zo.ref} method="post" className="flex flex-col gap-2">
      <Card className={tw("my-0 w-full", className)}>
        <div className=" border-b pb-5">
          <h2 className=" text-[18px] font-semibold">Permissions</h2>
          <p>
            Adjust specific permissions for <b>Self Service</b> and <b>Base</b>{" "}
            users.
          </p>
        </div>
        <input type="hidden" value={organization.id} name="id" />

        <h4 className="mt-5 text-text-md">Self service users</h4>
        <FormRow
          rowLabel={`View custody`}
          subHeading={
            <div>
              Allow <b>self service</b> users to <b>see</b> custody of assets
              and kits which are not assigned to them. By default they can only
              see custodian for assets that they are the custodian of.
            </div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              name={zo.fields.selfServiceCanSeeCustody()}
              id="selfServiceCustody"
              disabled={disabled}
              defaultChecked={organization.selfServiceCanSeeCustody}
            />
            <label
              htmlFor={`selfServiceCustody`}
              className=" hidden text-gray-500"
            >
              Allow
            </label>
          </div>
        </FormRow>

        <FormRow
          rowLabel={`View bookings`}
          subHeading={
            <div>
              Allow <b>self service</b> users to <b>see</b> bookings which are
              not assigned to them. By default they can only see bookings that
              they are the custodian of.
            </div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              name={zo.fields.selfServiceCanSeeBookings()}
              id="selfServiceBookings"
              disabled={disabled}
              defaultChecked={organization.selfServiceCanSeeBookings}
            />
            <label
              htmlFor={`selfServiceBookings`}
              className=" hidden text-gray-500"
            >
              Allow
            </label>
          </div>
        </FormRow>

        <h4 className="border-t pt-5 text-text-md">Base users</h4>
        <FormRow
          rowLabel={`View custody`}
          subHeading={
            <div>
              Allow <b>base</b> users to <b>see</b> custody of assets and kits
              which are not assigned to them. By default they can only see
              custodian for assets that they are the custodian of.
            </div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              name={zo.fields.baseUserCanSeeCustody()}
              id="baseUserCustody"
              disabled={disabled}
              defaultChecked={organization.baseUserCanSeeCustody}
            />
            <label
              htmlFor={`baseUserCustody`}
              className=" hidden text-gray-500"
            >
              Allow
            </label>
          </div>
        </FormRow>

        <FormRow
          rowLabel={`View bookings`}
          subHeading={
            <div>
              Allow <b>base</b> users to <b>see</b> bookings which are not
              assigned to them. By default they can only see bookings that they
              are the custodian of.
            </div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              name={zo.fields.baseUserCanSeeBookings()}
              id="baseUserBookings"
              disabled={disabled}
              defaultChecked={organization.baseUserCanSeeBookings}
            />
            <label
              htmlFor={`baseUserBookings`}
              className=" hidden text-gray-500"
            >
              Allow
            </label>
          </div>
        </FormRow>

        <div className="text-right">
          <Button
            type="submit"
            disabled={disabled}
            name="intent"
            value="permissions"
          >
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Card>
    </fetcher.Form>
  ) : null;
};

export const EditWorkspaceSSOSettingsFormSchema = (sso: boolean = false) =>
  z.object({
    id: z.string(),
    selfServiceGroupId: sso
      ? z.string().min(1, "Self service group id is required")
      : z.string().optional(),
    baseUserGroupId: sso
      ? z.string().min(1, "Base user group id is required")
      : z.string().optional(),
    adminGroupId: sso
      ? z.string().min(1, "Administrator group id is required")
      : z.string().optional(),
  });

const WorkspaceSSOEditForm = ({ className }: Props) => {
  const { organization } = useLoaderData<typeof loader>();
  const { isOwner } = useUserRoleHelper();
  const fetcher = useFetcher({ key: "sso" });
  let schema = EditWorkspaceSSOSettingsFormSchema(organization.enabledSso);
  const zo = useZorm("NewQuestionWizardScreen", schema);
  const disabled = useDisabled(fetcher);

  return isOwner && organization.enabledSso && organization.ssoDetails ? (
    <fetcher.Form ref={zo.ref} method="post" className="flex flex-col gap-2">
      <Card className={tw("my-0 ", className)}>
        <div className=" border-b pb-5">
          <h2 className=" text-[18px] font-semibold">SSO details</h2>
          <p>
            This workspace has SSO enabled so you can see your SSO settings.
          </p>
        </div>
        <input type="hidden" value={organization.id} name="id" />

        <FormRow
          rowLabel={"SSO Domain"}
          className="border-b-0 pb-[10px]"
          subHeading={
            "The domain that this workspace is linked to. If you want it changed, please contact support."
          }
          required
        >
          <Input
            label="SSO Domain"
            hideLabel
            disabled={true}
            className="disabled w-full"
            defaultValue={organization.ssoDetails.domain}
            required
          />
        </FormRow>

        <FormRow
          rowLabel={`Administrator role group id`}
          subHeading={
            <div>
              Place the Id of the group that should be mapped to the{" "}
              <b>Administrator</b> role.
            </div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <Input
            label={"Administrator role group id"}
            hideLabel
            className="w-full"
            name={zo.fields.adminGroupId()}
            error={zo.errors.adminGroupId()?.message}
            defaultValue={organization.ssoDetails.adminGroupId || undefined}
            required
          />
        </FormRow>

        <FormRow
          rowLabel={`Self service role group id`}
          subHeading={
            <div>
              Place the Id of the group that should be mapped to the{" "}
              <b>Self service</b> role.
            </div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <Input
            label={"Self service role group id"}
            hideLabel
            name={zo.fields.selfServiceGroupId()}
            error={zo.errors.selfServiceGroupId()?.message}
            defaultValue={
              organization.ssoDetails.selfServiceGroupId || undefined
            }
            className="w-full"
            required
          />
        </FormRow>
        <FormRow
          rowLabel={`Base user role group id`}
          subHeading={
            <div>
              Place the Id of the group that should be mapped to the <b>Base</b>{" "}
              role.
            </div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <Input
            label={"Base user role group id"}
            hideLabel
            name={zo.fields.baseUserGroupId()}
            error={zo.errors.baseUserGroupId()?.message}
            defaultValue={organization.ssoDetails.baseUserGroupId || undefined}
            className="w-full"
            required
          />
        </FormRow>
        <div className="text-right">
          <Button type="submit" disabled={disabled} name="intent" value="sso">
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Card>
    </fetcher.Form>
  ) : null;
};
