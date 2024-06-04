import { OrganizationType, Currency } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import { ExportButton } from "~/components/assets/export-button";
import { ErrorContent } from "~/components/errors";

import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { CustomTooltip } from "~/components/shared/custom-tooltip";
import { Spinner } from "~/components/shared/spinner";
import { db } from "~/database/db.server";
import { updateOrganization } from "~/modules/organization/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { canExportAssets } from "~/utils/subscription";
import { zodFieldIsRequired } from "~/utils/zod";
import { MAX_SIZE } from "./settings.workspace.new";

const EditWorkspaceFormSchema = z.object({
  logo: z.any().optional(),
  currency: z.custom<Currency>(),
  id: z.string(),
  name: z.string().min(2, "Name is required"),
});

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.generalSettings,
      action: PermissionAction.read,
    });

    const user = await db.user
      .findUniqueOrThrow({
        where: {
          id: userId,
        },
        select: {
          firstName: true,
          tier: {
            include: { tierLimit: true },
          },
          userOrganizations: {
            include: {
              organization: {
                include: {
                  _count: {
                    select: {
                      assets: true,
                      members: true,
                      locations: true,
                    },
                  },
                  owner: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
                      tier: {
                        include: { tierLimit: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "User not found",
          additionalData: { userId, organizationId },
          label: "Settings",
        });
      });

    const currentOrganization = user.userOrganizations.find(
      (userOrg) => userOrg.organizationId === organizationId
    );

    if (!currentOrganization) {
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        additionalData: { userId, organizationId },
        label: "Settings",
      });
    }

    const header: HeaderData = {
      title: "General",
    };

    return json(
      data({
        header,
        currentOrganization: currentOrganization.organization,
        canExportAssets: canExportAssets(
          currentOrganization.organization.owner.tier.tierLimit
        ),
        user,
        curriences: Object.keys(Currency),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "General",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorContent />;

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.generalSettings,
      action: PermissionAction.update,
    });

    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    const payload = parseData(formData, EditWorkspaceFormSchema, {
      additionalData: { userId, organizationId },
    });

    const { name, currency, id } = payload;

    const formDataFile = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({ maxPartSize: MAX_SIZE })
    );

    const file = formDataFile.get("image") as File | null;

    await updateOrganization({
      id,
      name,
      image: file || null,
      userId: authSession.userId,
      currency,
    });

    sendNotification({
      title: "Workspace updated",
      message: "Your workspace  has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect("/settings/general");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function GeneralPage() {
  const { currentOrganization, user, canExportAssets, curriences } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", EditWorkspaceFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);

  const isPersonalOrganization =
    currentOrganization.type === OrganizationType.PERSONAL;

  return (
    <div className="mb-2.5 flex flex-col justify-between bg-white md:rounded md:border md:border-gray-200 md:px-6 md:py-5">
      <div className=" mb-6">
        <h3 className="text-text-lg font-semibold">General</h3>
        <p className="text-sm text-gray-600">
          Manage general workspace settings.
        </p>
      </div>
      <Form
        method="post"
        ref={zo.ref}
        replace
        encType="multipart/form-data"
        className="border-t"
      >
        <FormRow
          rowLabel={"Workspace Name"}
          className="border-b-0 pb-[10px]"
          required={zodFieldIsRequired(EditWorkspaceFormSchema.shape.name)}
        >
          <div className="flex flex-col">
            {isPersonalOrganization ? (
              <CustomTooltip content={<TooltipContent />}>
                <Input
                  label="Workspace Name"
                  hideLabel
                  // name={zo.fields.name()}
                  disabled={true}
                  error={zo.errors.name()?.message}
                  className="w-full"
                  defaultValue={
                    isPersonalOrganization && `${user.firstName}'s Workspace`
                  }
                  placeholder="Enter workspace name"
                  required={false}
                />
              </CustomTooltip>
            ) : (
              <Input
                label="Workspace Name"
                hideLabel
                name={zo.fields.name()}
                disabled={disabled}
                error={zo.errors.name()?.message}
                autoFocus
                className="w-full"
                defaultValue={currentOrganization.name || undefined}
                placeholder="Enter workspace name"
                required={true}
              />
            )}
            <p className="text-sm text-gray-600">
              This name will be used in QR tags and other documentations.
            </p>
          </div>
        </FormRow>

        <FormRow rowLabel={"Main image"} className="border-b-0">
          <div>
            {isPersonalOrganization ? (
              <>
                <p className="hidden lg:block">
                  Accepts PNG, JPG or JPEG (max.4 MB)
                </p>
                <Input
                  disabled={true}
                  accept="image/png,.png,image/jpeg,.jpg,.jpeg"
                  name="image"
                  type="file"
                  label={"Main image"}
                  hideLabel
                  error={fileError}
                  className="mt-2"
                  inputClassName="border-0 shadow-none p-0 rounded-none"
                />
              </>
            ) : (
              <>
                <p className="hidden lg:block">
                  Accepts PNG, JPG or JPEG (max.4 MB)
                </p>
                <Input
                  disabled={disabled}
                  accept="image/png,.png,image/jpeg,.jpg,.jpeg"
                  name="image"
                  type="file"
                  onChange={validateFile}
                  label={"Main image"}
                  hideLabel
                  error={fileError}
                  className="mt-2"
                  inputClassName="border-0 shadow-none p-0 rounded-none"
                />
              </>
            )}
          </div>
        </FormRow>
        {isPersonalOrganization && (
          <input type="hidden" value={currentOrganization.name} name="name" />
        )}
        <div>
          <label className="lg:hidden">Currency</label>
          <FormRow rowLabel={"Currency"}>
            <Select
              defaultValue={currentOrganization.currency || "USD"}
              disabled={disabled}
              name={zo.fields.currency()}
            >
              <SelectTrigger className="px-3.5 py-3">
                <SelectValue placeholder="Choose a field type" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="w-full min-w-[300px]"
                align="start"
              >
                <div className=" max-h-[320px] overflow-auto">
                  {curriences.map((value) => (
                    <SelectItem value={value} key={value}>
                      <span className="mr-4 text-[14px] text-gray-700">
                        {value}
                      </span>
                    </SelectItem>
                  ))}
                </div>
              </SelectContent>
            </Select>
          </FormRow>
        </div>
        <input type="hidden" value={currentOrganization.id} name="id" />
        <div className="mt-5 text-right">
          <Button type="submit" disabled={disabled}>
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Form>

      <div className=" mb-6">
        <h4 className="text-text-lg font-semibold">Asset backup</h4>
        <p className=" text-sm text-gray-600">
          Download a backup of your assets. If you want to restore a backup,
          please get in touch with support.
        </p>
        <p className=" font-italic mb-2 text-sm text-gray-600">
          IMPORTANT NOTE: QR codes will not be included in the export. Due to
          the nature of how Shelf's QR codes work, they currently cannot be
          exported with assets because they have unique ids. <br />
          Importing a backup will just create a new QR code for each asset.
        </p>
        <ExportButton canExportAssets={canExportAssets} />
      </div>
    </div>
  );
}

function TooltipContent() {
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-gray-700">
        Unable to change the Name or Logo of Personal workspace.
      </p>
      <p className="text-sm">
        Create a Team workspace to fully customize them and enjoy extra
        features. Check out{" "}
        <Link
          className="font-bold text-primary-400"
          to="/settings/subscription"
        >
          Subscriptions
        </Link>{" "}
        to learn more.
      </p>
    </div>
  );
}
