import { useCallback, useEffect, useRef, useState } from "react";
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
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader } from "~/routes/_layout+/account-details.workspace.$workspaceId.edit";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
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
import { DateS } from "../shared/date";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";
import { Spinner } from "../shared/spinner";

export interface ScimTokenItem {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Pass props of the values to be used as default for the form fields */
interface Props {
  name?: Organization["name"];
  currency?: Organization["currency"];
  qrIdDisplayPreference?: Organization["qrIdDisplayPreference"];
  className?: string;
  scimTokens?: ScimTokenItem[];
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
  scimTokens,
}: Props) => (
  <div className={tw("flex flex-col gap-3", className)}>
    <WorkspaceGeneralEditForms
      name={name}
      currency={currency}
      qrIdDisplayPreference={qrIdDisplayPreference}
    />
    <WorkspacePermissionsEditForm />
    <WorkspaceSSOEditForm />
    <WorkspaceScimTokensSection scimTokens={scimTokens} />
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
            rowLabel={"QR Code Display"}
            className={"border-b-0"}
            subHeading={
              <p>
                Choose which identifier is shown on QR code labels. You can
                display either the QR code ID or the asset's SAM ID.
              </p>
            }
          >
            <InnerLabel hideLg>QR Code Display</InnerLabel>
            <QrIdDisplayPreferenceSelector
              name={zo.fields.qrIdDisplayPreference()}
              defaultValue={qrIdDisplayPreference || "QR_ID"}
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
  const schema = EditWorkspaceSSOSettingsFormSchema(organization.enabledSso);
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

const WorkspaceScimTokensSection = ({
  scimTokens,
  className,
}: {
  scimTokens?: ScimTokenItem[];
  className?: string;
}) => {
  const { organization } = useLoaderData<typeof loader>();
  const { isOwner } = useUserRoleHelper();
  const generateFetcher = useFetcher({ key: "generateScimToken" });
  const deleteFetcher = useFetcher({ key: "deleteScimToken" });
  const generateDisabled = useDisabled(generateFetcher);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);
  const [tokenToDelete, setTokenToDelete] = useState<ScimTokenItem | null>(
    null
  );
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Extract the raw token from the generate action response
  const generateData = generateFetcher.data as
    | { rawToken?: string }
    | undefined;
  const newToken = generateData?.rawToken;

  // Show dialog when a new token is generated (but not if already dismissed)
  if (newToken && newToken !== revealedToken && newToken !== dismissedToken) {
    setRevealedToken(newToken);
    setCopied(false);
  }

  // Close delete confirmation dialog after successful deletion
  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data) {
      setTokenToDelete(null);
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  const handleCopy = useCallback(() => {
    if (revealedToken) {
      void navigator.clipboard.writeText(revealedToken);
      setCopied(true);
    }
  }, [revealedToken]);

  if (!isOwner || !organization.enabledSso || !organization.ssoDetails) {
    return null;
  }

  return (
    <>
      <Card className={tw("my-0", className)}>
        <div className="border-b pb-5">
          <h2 className="text-[18px] font-semibold">SCIM provisioning</h2>
          <p className="text-sm text-gray-600">
            Manage bearer tokens for SCIM user provisioning (e.g. Microsoft
            Entra ID).
          </p>
        </div>

        {/* Token list */}
        {scimTokens && scimTokens.length > 0 ? (
          <div className="mt-4">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500">
                  <th className="pb-2 font-medium">Label</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Last used</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scimTokens.map((token) => (
                  <tr key={token.id} className="border-b last:border-b-0">
                    <td className="py-3 font-medium">{token.label}</td>
                    <td className="py-3 text-gray-600">
                      <DateS date={token.createdAt} />
                    </td>
                    <td className="py-3 text-gray-600">
                      {token.lastUsedAt ? (
                        <DateS date={token.lastUsedAt} />
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <Button
                        variant="secondary"
                        className="text-error-500 hover:text-error-600"
                        onClick={() => setTokenToDelete(token)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            No active SCIM tokens. Generate one to enable SCIM provisioning.
          </p>
        )}

        {/* Generate form */}
        <generateFetcher.Form method="post" className="mt-4 flex gap-2">
          <Input
            ref={labelInputRef}
            label="Token label"
            hideLabel
            name="label"
            placeholder="Token label (e.g. Entra ID Production)"
            className="flex-1"
            required
          />
          <Button
            type="submit"
            name="intent"
            value="generateScimToken"
            disabled={generateDisabled}
          >
            {generateDisabled ? <Spinner /> : "Generate token"}
          </Button>
        </generateFetcher.Form>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!tokenToDelete}
        onOpenChange={(open) => {
          if (!open) setTokenToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SCIM token</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the token &ldquo;
              {tokenToDelete?.label}&rdquo;? Any SCIM integration using this
              token will stop working immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="secondary" onClick={() => setTokenToDelete(null)}>
              Cancel
            </Button>
            <deleteFetcher.Form method="post">
              <input
                type="hidden"
                name="tokenId"
                value={tokenToDelete?.id ?? ""}
              />
              <Button
                type="submit"
                variant="primary"
                name="intent"
                value="deleteScimToken"
                className="bg-error-500 hover:bg-error-600"
              >
                Delete
              </Button>
            </deleteFetcher.Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Token reveal dialog */}
      <AlertDialog
        open={!!revealedToken}
        onOpenChange={(open) => {
          if (!open) {
            setDismissedToken(revealedToken);
            setRevealedToken(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>SCIM token generated</AlertDialogTitle>
            <AlertDialogDescription>
              Copy this token now. It will not be shown again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-2">
            <code className="block break-all rounded border bg-gray-50 p-3 text-sm">
              {revealedToken}
            </code>
          </div>
          <AlertDialogFooter>
            <Button variant="secondary" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy to clipboard"}
            </Button>
            <Button
              onClick={() => {
                setDismissedToken(revealedToken);
                setRevealedToken(null);
              }}
            >
              Done
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
