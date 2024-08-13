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
import { getAllEntriesForCreateAndEdit } from "~/modules/asset/service.server";
import {
  countActiveCustomFields,
  getCustomField,
  updateCustomField,
} from "~/modules/custom-field/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canCreateMoreCustomFields } from "~/utils/subscription.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { fieldId: id } = getParams(params, z.object({ fieldId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: PermissionAction.update,
    });

    const customField = await getCustomField({ organizationId, id });

    const { categories, totalCategories } = await getAllEntriesForCreateAndEdit(
      {
        organizationId,
        request,
        defaults: { category: customField.categories.map((c) => c.id) },
      }
    );

    const header: HeaderData = {
      title: `Edit | ${customField.name}`,
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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>Edit</span>,
};

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
      /** Get the tier limit and check if they can export */
      const tierLimit = await getOrganizationTierLimit({
        organizationId,
        organizations,
      });

      const totalActiveCustomFields = await countActiveCustomFields({
        organizationId,
      });

      const canCreateMore = canCreateMoreCustomFields({
        tierLimit,
        totalCustomFields: totalActiveCustomFields,
      });

      if (!canCreateMore) {
        throw new ShelfError({
          cause: null,
          message:
            "You have reached your limit of active custom fields. Please upgrade your plan to add more.",
          additionalData: {
            userId,
            active,
            totalActiveCustomFields,
            tierLimit,
            validationErrors: {
              active: {
                message: `You have reached your limit of active custom fields. Please upgrade your plan to add more.`,
              },
            },
          },
          label: "Custom fields",
          status: 403,
          shouldBeCaptured: false,
        });
      }
    }

    await updateCustomField({
      id,
      name,
      helpText,
      active,
      required,
      options,
      categories,
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
