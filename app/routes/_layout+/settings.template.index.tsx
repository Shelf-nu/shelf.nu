import type { Template } from "@prisma/client";
import { TemplateType } from "@prisma/client";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { EmptyState } from "~/components/list/empty-state";
import { ListHeader } from "~/components/list/list-header";
import { ListItem } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { Table, Td, Th } from "~/components/table";
import { TemplateActionsDropdown } from "~/components/templates/template-actions-dropdown";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { makeDefault, toggleTemplateActiveState } from "~/modules/template";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { data, error, getActionMethod, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canCreateMoreTemplates } from "~/utils/subscription.server";

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.template,
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
          templates: {
            where: { organizationId },
            orderBy: { createdAt: "desc" },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "An error occured while fetching the user",
          additionalData: { userId },
          label: "Template",
        });
      });

    const modelName = {
      singular: "Template",
      plural: "Templates",
    };

    const templates = user.templates;

    const defaultTemplates: { [key: string]: Template } = {};
    templates.forEach((template) => {
      if (template.isDefault) defaultTemplates[template.type] = template;
    });

    return json(
      data({
        userId,
        tier: user.tier,
        modelName,
        canCreateMoreTemplates: canCreateMoreTemplates({
          tierLimit: user.tier.tierLimit,
          totalTemplates: templates.length,
        }),
        items: templates,
        totalItems: templates.length,
        title: "Templates",
        defaultTemplates,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
};

export async function action({ context, request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    const authSession = context.getSession();
    let organizationId = null;

    switch (method) {
      case "POST": {
        const { organizationId: orgId } = await requirePermission({
          userId: authSession.userId,
          request,
          entity: PermissionEntity.template,
          action: PermissionAction.update,
        });
        organizationId = orgId;

        const formData = await request.clone().formData();

        const { intent } = parseData(
          await request.formData(),
          z.object({
            intent: z.enum(["toggleActive", "makeDefault"]),
          })
        );

        switch (intent) {
          case "toggleActive": {
            const { isActive, templateId } = parseData(
              formData,
              z.object({
                isActive: z
                  .string()
                  .transform((val) => (val === "yes" ? true : false)),
                templateId: z.string(),
              })
            );

            await toggleTemplateActiveState({
              id: templateId,
              active: !isActive,
              organizationId: organizationId,
            });

            sendNotification({
              title: "Template updated",
              message: `Your template has been successfully ${
                isActive ? "deactivated" : "activated"
              }`,
              icon: { name: "success", variant: "success" },
              senderId: authSession.userId,
            });

            return redirect(`/settings/template`);
          }
          case "makeDefault": {
            const { templateId, templateType } = parseData(
              formData,
              z.object({
                templateId: z.string(),
                templateType: z.nativeEnum(TemplateType),
              })
            );

            await makeDefault({
              id: templateId,
              type: templateType,
              organizationId,
            });

            sendNotification({
              title: "Template updated",
              message: "Your default template has been successfully changed.",
              icon: { name: "success", variant: "success" },
              senderId: authSession.userId,
            });

            return json(data({ changedDefault: true }));
          }
        }
      }
    }
    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function TemplatePage() {
  const { items, totalItems, canCreateMoreTemplates } =
    useLoaderData<typeof loader>();

  const hasItems = totalItems > 0;

  // let upgradeMessage =
  //   "You are currently able to create a max of 3 templates. If you want to create more than 3 Team templates, please get in touch with sales";
  // if (tier.id !== TierId.tier_2) {
  //   upgradeMessage = `You cannot create more than ${tier.tierLimit?.maxTemplates} templates on a ${tier.name} subscription. `;
  // }

  return (
    <div className="w-full bg-white md:rounded md:border md:px-6 md:py-5">
      <h2 className="text-lg text-gray-900">Templates</h2>
      <p className="text-sm text-gray-600">Manage all your templates here.</p>

      <Separator className="my-4" />

      <div className="flex flex-col justify-between gap-4 gap-x-5 md:flex-row">
        <div className="w-full md:max-w-72">
          <h3 className="mb-1 text-sm text-gray-600">PDF Templates</h3>
          <p className="text-sm text-gray-600">
            Use these templates to generate a PDF document for assigning custody
            and your bookings. You can even set them up to require an electronic
            signature. Default means that this template will be first selected.
          </p>
        </div>

        <div className="flex w-full flex-col items-center rounded border">
          {!hasItems ? (
            <EmptyState
              customContent={{
                title: "No templates on database",
                text: "What are you waiting for? Add your first template now!",
                newButtonRoute: `new`,
                newButtonContent: "Add Template",
              }}
              modelName={{
                singular: "template",
                plural: "templates",
              }}
            />
          ) : (
            <>
              <div className="flex w-full items-center justify-between p-4">
                <div>
                  <h3 className="text-md text-gray-900">PDF Templates</h3>
                  <p className="text-sm text-gray-600">{totalItems} items</p>
                </div>

                <When truthy={canCreateMoreTemplates}>
                  <Button
                    to="new"
                    role="link"
                    icon="plus"
                    aria-label="new template"
                  >
                    Add template
                  </Button>
                </When>
              </div>

              <div className="w-full flex-1 border-t">
                <Table>
                  <ListHeader
                    children={
                      <>
                        <Th>Default</Th>
                        <Th>Status</Th>
                        <Th>Actions</Th>
                      </>
                    }
                  />
                  <tbody>
                    {items.map((template) => (
                      <ListItem item={template} key={template.id}>
                        <TemplateRow item={template} />
                      </ListItem>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TemplateRow = ({
  item,
}: {
  item: Pick<Template, "id" | "name" | "type" | "isDefault" | "isActive">;
}) => (
  <>
    <Td className="w-full">
      <div className="flex flex-col items-start justify-between">
        <span className="text-text-sm font-medium text-gray-900">
          {item.name}
        </span>
        <span className="text-text-sm font-light lowercase text-gray-600 first-letter:uppercase">
          {item.type}
        </span>
      </div>
    </Td>
    <Td>
      {item.isDefault && (
        <Badge withDot={false} color="#334054">
          Default
        </Badge>
      )}
    </Td>
    <Td>
      <Badge
        color={item.isActive ? "#0dec5d" : "#344054"}
        withDot={item.isActive}
      >
        {item.isActive ? "Active" : "Inactive"}
      </Badge>
    </Td>
    <Td>
      <TemplateActionsDropdown template={item} />
    </Td>
  </>
);
