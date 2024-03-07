import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  CustomFieldForm,
  NewCustomFieldFormSchema,
} from "~/components/custom-fields/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  countAcviteCustomFields,
  getCustomField,
  updateCustomField,
} from "~/modules/custom-field";
import { getOrganizationTierLimit } from "~/modules/tier";
import { getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import { canCreateMoreCustomFields } from "~/utils/subscription";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = await context.getSession();

  const { organizationId } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.customField,
    action: PermissionAction.update,
  });

  const id = getRequiredParam(params, "fieldId");

  const { customField } = await getCustomField({ organizationId, id });
  if (!customField) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${customField.name}`,
  };

  return json({
    customField,
    header,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>Edit</span>,
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = await context.getSession();

  const { organizationId, organizations } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.customField,
    action: PermissionAction.update,
  });

  const id = getRequiredParam(params, "fieldId");
  const formData = await request.formData();
  const result = await NewCustomFieldFormSchema.safeParseAsync(
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
      }
    );
  }

  const { name, helpText, active, required, options } = result.data;

  /** If they are activating a field, we have to make sure that they are not already at the limit */
  if (active) {
    /** Get the tier limit and check if they can export */
    const tierLimit = await getOrganizationTierLimit({
      organizationId,
      organizations,
    });

    const totalActiveCustomFields = await countAcviteCustomFields({
      organizationId,
    });

    const canCreateMore = canCreateMoreCustomFields({
      tierLimit,
      totalCustomFields: totalActiveCustomFields,
    });
    if (!canCreateMore) {
      return json(
        {
          errors: {
            active: {
              message: `You have reached your limit of active custom fields. Please upgrade your plan to add more.`,
            },
          },
          success: false,
        },
        {
          status: 400,
        }
      );
    }
  }

  const rsp = await updateCustomField({
    id,
    name,
    helpText,
    active,
    required,
    options,
  });

  if (rsp.error) {
    return json(
      {
        errors: { name: rsp.error },
        success: false,
      },
      {
        status: 400,
      }
    );
  }

  sendNotification({
    title: "Custom field updated",
    message: "Your custom field  has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return json({ success: true, errors: null });
}

export default function CustomFieldEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { customField } = useLoaderData<typeof loader>();

  return (
    <>
      <Header
        hideBreadcrumbs
        title={hasName ? name : customField.name}
        classNames="-mt-5"
      />
      <div className=" items-top flex justify-between">
        <CustomFieldForm
          isEdit
          name={customField.name || name}
          helpText={customField.helpText}
          required={customField.required}
          type={customField.type}
          active={customField.active}
          options={customField.options}
        />
      </div>
    </>
  );
}
