import {
  type Organization,
  type Currency,
  OrganizationType,
  type QrIdDisplayPreference,
} from "@prisma/client";
import { useAtom, useAtomValue } from "jotai";
import { useFetcher, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, defaultValidateFileAtom } from "~/atoms/file";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader } from "~/routes/_layout+/account-details.workspace.$workspaceId.edit";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import CurrencySelector from "./currency-selector";
import QrIdDisplayPreferenceSelector from "./qr-id-display-preference-selector";
import FormRow from "../forms/form-row";
import { InnerLabel } from "../forms/inner-label";
import Input from "../forms/input";
import { Switch } from "../forms/switch";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

/** Pass props of the values to be used as default for the form fields */
interface Props {
  name?: Organization["name"];
  currency?: Organization["currency"];
  qrIdDisplayPreference?: Organization["qrIdDisplayPreference"];
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
    qrIdDisplayPreference: z.custom<QrIdDisplayPreference>(),
    showShelfBranding: z
      .union([z.literal("on"), z.literal("off"), z.undefined()])
      .transform((value) => {
        if (value === undefined) return undefined;
        return value === "on";
      })
      .optional(),
  });

export const WorkspaceEditForms = ({
  name,
  currency,
  qrIdDisplayPreference,
  className,
}: Props) => (
  <div className={tw("flex flex-col gap-3", className)}>
    <WorkspaceGeneralEditForms
      name={name}
      currency={currency}
      qrIdDisplayPreference={qrIdDisplayPreference}
    />
    <WorkspacePermissionsEditForm />
    <WorkspaceSSOEditForm />
  </div>
);

const WorkspaceGeneralEditForms = ({
  name,
  currency,
  qrIdDisplayPreference,
  className,
}: Props) => {
  const { organization, isPersonalWorkspace, canHideShelfBranding } =
    useLoaderData<typeof loader>();

  // Focus the Name input on mount, but skip when the field is disabled
  // (personal workspaces don't allow renaming).
  const nameInputRef = useAutoFocus<HTMLInputElement>({
    when: !isPersonalWorkspace,
  });

  const schema = EditGeneralWorkspaceSettingsFormSchema(isPersonalWorkspace);
  const zo = useZorm("NewQuestionWizardScreen", schema);
  const fetcher = useFetcher({ key: "general" });
  const disabled = useDisabled(fetcher);
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(defaultValidateFileAtom);
  const [, updateTitle] = useAtom(updateDynamicTitleAtom);

  const fetcherError = (
    fetcher.data as
      | {
          error?: {
            message: string;
            additionalData?: { field?: string };
          };
        }
      | undefined
  )?.error;

  const imageError =
    (fetcherError?.additionalData?.field === "image"
      ? fetcherError.message
      : undefined) ?? fileError;

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
            ref={nameInputRef}
            label="Name"
            hideLabel
            name={zo.fields.name()}
            disabled={isPersonalWorkspace || disabled}
            error={zo.errors.name()?.message}
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
              Accepts PNG, JPG, JPEG, or WebP (max.4 MB)
            </p>
            <Input
              // disabled={disabled}
              accept={ACCEPT_SUPPORTED_IMAGES}
              name="image"
              type="file"
              onChange={validateFile}
              label={"Main image"}
              hideLabel
              error={imageError}
              className="mt-2"
              inputClassName="border-0 shadow-none p-0 rounded-none"
            />
            <p className="mt-2 lg:hidden">
              Accepts PNG, JPG, JPEG, or WebP (max.4 MB)
            </p>
          </div>
        </FormRow>

        <div>
          <FormRow
            rowLabel={"Currency"}
            className={"border-b-0"}
            subHeading="Choose the currency for your workspace. All ISO 4217 currencies are supported."
          >
            <InnerLabel hideLg>Currency</InnerLabel>
            <CurrencySelector
              defaultValue={currency || "USD"}
              name={zo.fields.currency()}
            />
          </FormRow>
        </div>

        <div>
          <FormRow
            rowLabel={"Preferred display code"}
            className={"border-b-0"}
            subHeading={
              <div className="space-y-2 text-gray-600">
                <p>
                  Pick which code is shown next to every asset and kit on list
                  views (assets, kits, bookings, audits, locations) — so a Sony
                  A7-III can be told apart from 19 others at a glance.
                </p>
                <p>
                  Need an exception for one asset?{" "}
                  <strong>Override it on the asset's edit page</strong> — pick a
                  specific barcode to display for that one item.
                </p>
                <p className="text-xs text-gray-500">
                  QR ID and SAM ID are always available.{" "}
                  {organization.barcodesEnabled
                    ? "Barcode-type options are unlocked because your workspace has the alternative-barcodes add-on."
                    : "Barcode-type options unlock with the alternative-barcodes add-on."}{" "}
                  When an asset doesn't have your preferred type, the chip falls
                  back to its QR code (rendered with an outlined style so the
                  missing data stays visible). Printed QR labels continue to
                  show the QR id today regardless of this setting — barcode-type
                  label printing is on the v1.1 roadmap.
                </p>
              </div>
            }
          >
            <InnerLabel hideLg>Preferred display code</InnerLabel>
            <QrIdDisplayPreferenceSelector
              name={zo.fields.qrIdDisplayPreference()}
              defaultValue={qrIdDisplayPreference || "QR_ID"}
              canUseBarcodes={organization.barcodesEnabled}
            />
          </FormRow>
        </div>

        <FormRow
          rowLabel={"Label branding"}
          className={"border-b-0"}
          subHeading={
            canHideShelfBranding ? (
              <p>
                Control whether the "Powered by Shelf.nu" footer appears on QR
                and barcode labels.
              </p>
            ) : (
              <p>
                This is a premium feature.{" "}
                <Button
                  variant="link"
                  className="inline text-xs"
                  to="/account-details/subscription"
                >
                  Upgrade your plan
                </Button>{" "}
                to hide Shelf branding on labels.
              </p>
            )
          }
        >
          <div className="flex items-center gap-3">
            <input
              type="hidden"
              name={zo.fields.showShelfBranding()}
              value="off"
            />
            <Switch
              id="showShelfBranding"
              name={zo.fields.showShelfBranding()}
              defaultChecked={organization.showShelfBranding ?? true}
              disabled={!canHideShelfBranding}
              aria-labelledby="showShelfBranding-label"
              aria-describedby="showShelfBranding-desc"
            />
            <div>
              <label
                id="showShelfBranding-label"
                htmlFor="showShelfBranding"
                className={tw(
                  "cursor-pointer text-[14px] font-medium",
                  canHideShelfBranding ? "text-gray-700" : "text-gray-400"
                )}
              >
                Display Shelf branding on labels
              </label>
              <p
                id="showShelfBranding-desc"
                className="text-[14px] text-gray-600"
              >
                Toggle Shelf branding on downloadable QR and barcode labels.
              </p>
            </div>
          </div>
        </FormRow>

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
  const schema = EditWorkspacePermissionsSettingsFormSchema();
  const zo = useZorm("NewQuestionWizardScreen", schema);
  const disabled = useDisabled(fetcher);

  return organization.type === OrganizationType.TEAM ? (
    <fetcher.Form ref={zo.ref} method="post" className="flex flex-col gap-2">
      <Card className={tw("my-0 w-full", className)}>
        <div className="border-b pb-5">
          <h3 className="text-text-lg font-semibold">Permissions</h3>
          <p className="text-sm text-gray-600">
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

/**
 * Schema for the workspace SSO settings form.
 *
 * Group mappings are intentionally individually optional: a workspace only
 * needs to map the roles it actually uses. The auth-side role resolver
 * (`getRoleFromGroupId`) and SSO user provisioning evaluate each mapped group
 * independently, so a single mapping is enough for SSO to work.
 *
 * When SSO is enabled we still require **at least one** group to be mapped —
 * otherwise the configuration is a no-op that silently grants no access. That
 * cross-field rule is enforced via `superRefine` and surfaced on the first
 * (Administrator) field.
 *
 * @param sso - Whether SSO is enabled for the workspace. When false, all group
 *   fields are optional and the "at least one" rule is skipped.
 */
export const EditWorkspaceSSOSettingsFormSchema = (sso: boolean = false) =>
  z
    .object({
      id: z.string(),
      selfServiceGroupId: z.string().optional(),
      baseUserGroupId: z.string().optional(),
      adminGroupId: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (!sso) return;

      const hasAtLeastOneGroup = [
        data.adminGroupId,
        data.selfServiceGroupId,
        data.baseUserGroupId,
      ].some((value) => value != null && value.trim().length > 0);

      if (!hasAtLeastOneGroup) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Map at least one group to a role. Only the roles you use need a group.",
          path: ["adminGroupId"],
        });
      }
    });

const WorkspaceSSOEditForm = ({ className }: Props) => {
  const { organization } = useLoaderData<typeof loader>();
  const { isOwner } = useUserRoleHelper();
  const fetcher = useFetcher({ key: "sso" });
  const schema = EditWorkspaceSSOSettingsFormSchema(organization.enabledSso);
  const zo = useZorm("NewQuestionWizardScreen", schema);
  const disabled = useDisabled(fetcher);

  /**
   * Server-side validation errors, surfaced as a fallback in case client-side
   * validation is bypassed. The SSO form submits via a fetcher, so we read the
   * error off `fetcher.data` rather than `useActionData`.
   */
  const validationErrors = getValidationErrors<typeof schema>(
    (fetcher.data as DataOrErrorResponse | undefined)?.error
  );

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

        {/* Group identifiers differ per identity provider, and the field
            stores whatever the IdP returns in the user's `groups` attribute.
            Spell out the convention so owners don't paste the wrong value. */}
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-[14px] text-gray-600">
          <p>
            Map your identity provider's groups to Shelf roles below. You only
            need to map the roles you use — <b>at least one</b> mapping is
            required, the rest can be left blank.
          </p>
          <p className="mt-2">
            Enter the value(s) your identity provider sends in the user's{" "}
            <b>groups</b> claim. <b>Google Workspace</b> returns group{" "}
            <b>names</b>. <b>Microsoft Entra</b> returns the group{" "}
            <b>Object ID</b>. <b>Okta</b> and most other providers return the
            group <b>name</b> (depending on how your groups attribute statement
            is configured). <b>Shibboleth</b> releases the value from your{" "}
            <b>isMemberOf</b>, <b>eduPersonEntitlement</b>, or{" "}
            <b>eduPersonScopedAffiliation</b> attribute (e.g.{" "}
            <b>staff@your.edu</b>, a Grouper path, or a group name/DN). Matching
            is trimmed and case-insensitive, but paste the value(s) exactly as
            your IdP sends them.
          </p>
          <p className="mt-2">
            Each field accepts <b>one or more group IDs, separated by commas</b>{" "}
            (e.g. <b>it-admins, shelf-admins</b>) — useful when more than one
            IdP group should map to the same role.
          </p>
        </div>

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
          rowLabel={`Administrator role group`}
          subHeading={
            <div>
              The group identifier that should be mapped to the{" "}
              <b>Administrator</b> role.
            </div>
          }
          className="border-b-0 pb-[10px]"
        >
          <Input
            label={"Administrator role group"}
            hideLabel
            className="w-full"
            name={zo.fields.adminGroupId()}
            error={
              validationErrors?.adminGroupId?.message ||
              zo.errors.adminGroupId()?.message
            }
            defaultValue={organization.ssoDetails.adminGroupId || undefined}
          />
        </FormRow>

        <FormRow
          rowLabel={`Self service role group`}
          subHeading={
            <div>
              The group identifier that should be mapped to the{" "}
              <b>Self service</b> role.
            </div>
          }
          className="border-b-0 pb-[10px]"
        >
          <Input
            label={"Self service role group"}
            hideLabel
            name={zo.fields.selfServiceGroupId()}
            error={
              validationErrors?.selfServiceGroupId?.message ||
              zo.errors.selfServiceGroupId()?.message
            }
            defaultValue={
              organization.ssoDetails.selfServiceGroupId || undefined
            }
            className="w-full"
          />
        </FormRow>
        <FormRow
          rowLabel={`Base user role group`}
          subHeading={
            <div>
              The group identifier that should be mapped to the <b>Base</b>{" "}
              role.
            </div>
          }
          className="border-b-0 pb-[10px]"
        >
          <Input
            label={"Base user role group"}
            hideLabel
            name={zo.fields.baseUserGroupId()}
            error={
              validationErrors?.baseUserGroupId?.message ||
              zo.errors.baseUserGroupId()?.message
            }
            defaultValue={organization.ssoDetails.baseUserGroupId || undefined}
            className="w-full"
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
