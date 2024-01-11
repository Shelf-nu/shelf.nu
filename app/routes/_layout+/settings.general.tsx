import type { $Enums } from "@prisma/client";
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
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import { ErrorBoundryComponent } from "~/components/errors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared";
import { CustomTooltip } from "~/components/shared/custom-tooltip";
import { Spinner } from "~/components/shared/spinner";
import { db } from "~/database";
import { commitAuthSession } from "~/modules/auth";
import { updateOrganization } from "~/modules/organization";
import { isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import { zodFieldIsRequired } from "~/utils/zod";
import { MAX_SIZE } from "./settings.workspace.new";

const EditWorkspaceFormSchema = z.object({
  logo: z.any().optional(),
  currency: z.custom<Currency>(),
  id: z.string(),
  name: z.string().min(2, "Name is required"),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { authSession, organizationId } = await requirePermision(
    request,
    PermissionEntity.generalSettings,
    PermissionAction.read
  );
  const { userId } = authSession;

  const user = await db.user.findUnique({
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
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user || user.userOrganizations?.length < 1)
    throw new ShelfStackError({ message: "Organization not found" });

  const currentOrganization = user.userOrganizations.find(
    (userOrg) => userOrg.organizationId === organizationId
  );

  if (!currentOrganization)
    throw new ShelfStackError({ message: "Organization not found" });

  const header: HeaderData = {
    title: "General",
  };

  return json({
    header,
    currentOrganization: currentOrganization.organization,
    user,
  });
}

export const handle = {
  breadcrumb: () => "General",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorBoundryComponent />;

export async function action({ request }: ActionFunctionArgs) {
  const { authSession } = await requirePermision(
    request,
    PermissionEntity.generalSettings,
    PermissionAction.update
  );

  const clonedRequest = request.clone();
  const formData = await clonedRequest.formData();
  const result = await EditWorkspaceFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
        success: false,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  const { name, currency, id } = result.data;
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

  return redirect("/settings/general", {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function GeneralPage() {
  const { currentOrganization, user } = useLoaderData<typeof loader>();
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
        className="border-t-[1px]"
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
                  {Object.keys(Currency).map((value) => (
                    <SelectItem value={value} key={value}>
                      <span className="mr-4 text-[14px] text-gray-700">
                        {Currency[value as $Enums.Currency]}
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
        <Link className="font-bold text-primary-400" to="settings/subscription">
          Subscriptions
        </Link>{" "}
        to learn more.
      </p>
    </div>
  );
}
