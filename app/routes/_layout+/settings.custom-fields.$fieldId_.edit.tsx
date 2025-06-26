import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  CustomFieldForm,
  NewCustomFieldFormSchema,
} from "~/components/custom-fields/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { getCategoriesForCreateAndEdit } from "~/modules/asset/service.server";
import {
  getCustomField,
  updateCustomField,
} from "~/modules/custom-field/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { FIELD_TYPE_NAME } from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanCreateMoreCustomFields } from "~/utils/subscription.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>Edit</span>,
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { fieldId: id } = getParams(params, z.object({ fieldId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: PermissionAction.update,
    });

    const customField = await getCustomField({
      organizationId,
      id,
      userOrganizations,
      request,
      include: { categories: { select: { id: true } } },
    });

    const { categories, totalCategories } = await getCategoriesForCreateAndEdit(
      {
        organizationId,
        request,
        defaultCategory: customField.categories.map((c) => c.id),
      }
    );

    const header: HeaderData = {
      title: `Edit | ${customField.name}`,
      subHeading: FIELD_TYPE_NAME[customField.type],
    };

    return json(
      data({
        customField,
        header,
        categories,
        totalCategories,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { fieldId: id } = getParams(params, z.object({ fieldId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, organizations } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: PermissionAction.update,
    });

    const payload = parseData(
      await request.formData(),
      NewCustomFieldFormSchema
    );

    const { name, helpText, active, required, options, categories } = payload;

    const field = await getCustomField({ organizationId, id });

    /** If they are activating a field, we have to make sure that they are not already at the limit */
    const isActivatingField = !field.active && active !== field.active;

    if (isActivatingField) {
      await assertUserCanCreateMoreCustomFields({
        organizationId,
        organizations,
      });
    }

    await updateCustomField({
      id,
      name,
      helpText,
      active,
      required,
      options,
      categories,
      organizationId,
    });

    sendNotification({
      title: "Custom field updated",
      message: "Your custom field  has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
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
          categories={customField.categories.map((c) => c.id)}
        />
      </div>
    </>
  );
}
