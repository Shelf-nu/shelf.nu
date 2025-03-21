import { type CustodyAgreement } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { AgreementsActionsDropdown } from "~/components/agreements/agreements-actions-dropdown";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { EmptyState } from "~/components/list/empty-state";
import { ListHeader } from "~/components/list/list-header";
import { ListItem } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { Table, Td, Th } from "~/components/table";
import { db } from "~/database/db.server";
import {
  makeCustodyAgreementDefault,
  toggleCustodyAgreementActiveState,
} from "~/modules/custody-agreement";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canCreateMoreAgreements } from "~/utils/subscription.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const [agreements, totalAgreements, tierLimit] = await Promise.all([
      db.custodyAgreement.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
      }),
      db.custodyAgreement.count({
        where: { organizationId, isActive: true },
      }),
      getOrganizationTierLimit({ organizations, organizationId }),
    ]);

    const canCreateAgreements = canCreateMoreAgreements({
      tierLimit,
      totalAgreements,
    });

    const defaultAgreements = agreements.reduce(
      (acc, curr) => {
        if (curr.isDefault) {
          acc = {
            ...acc,
            [curr.type]: curr,
          };
        }

        return acc;
      },
      {} as Record<string, CustodyAgreement>
    );

    const modelName = {
      singular: "Agreement",
      plural: "Agreements",
    };

    const header: HeaderData = {
      title: "Agreements",
    };

    return json(
      data({
        modelName,
        header,
        canCreateMoreAgreements: canCreateAgreements,
        items: agreements,
        totalItems: agreements.length,
        defaultAgreements,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["toggleActive", "makeDefault"]),
      })
    );

    switch (intent) {
      case "toggleActive": {
        const { agreementId } = parseData(
          formData,
          z.object({ agreementId: z.string() })
        );

        const updatedAgreement = await toggleCustodyAgreementActiveState({
          id: agreementId,
          organizationId,
          organizations,
        });

        sendNotification({
          title: "Agreement updated",
          message: `Your agreement has been successfully ${
            updatedAgreement.isActive ? "activated" : "deactivated"
          }`,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return redirect("/agreements");
      }
      case "makeDefault": {
        const { agreementId } = parseData(
          formData,
          z.object({ agreementId: z.string() })
        );

        await makeCustodyAgreementDefault({
          id: agreementId,
          organizationId,
        });

        sendNotification({
          title: "Agreement updated",
          message: "Your default agreement has been successfully changed.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ changedDefault: true }));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export default function Agreements() {
  const { items, totalItems, canCreateMoreAgreements } =
    useLoaderData<typeof loader>();

  const hasItems = totalItems > 0;

  return (
    <>
      <Header classNames="mb-4" />

      <div className="w-full bg-white md:rounded md:border md:px-6 md:py-5">
        <h2 className="text-lg text-gray-900">Agreements</h2>
        <p className="text-sm text-gray-600">
          Manage all your agreements here.
        </p>
        <Separator className="my-4" />
        <div className="flex flex-col justify-between gap-4 gap-x-5 md:flex-row">
          <div className="w-full md:max-w-72">
            <h3 className="mb-1 text-sm text-gray-600">PDF Agreements</h3>
            <p className="text-sm text-gray-600">
              Use these agreements to generate a PDF document for assigning
              custodies. You can even set them up to require an electronic
              signature. Default means that this agreement will be first
              selected.
            </p>
          </div>
          <div className="flex w-full flex-col items-center rounded border">
            {!hasItems ? (
              <EmptyState
                customContent={{
                  title: "No agreement on database",
                  text: "What are you waiting for? Add your first agreement now!",
                  newButtonRoute: `new`,
                  newButtonContent: "Add Agreement",
                }}
                modelName={{
                  singular: "agreement",
                  plural: "agreement",
                }}
              />
            ) : (
              <>
                <div className="flex w-full items-center justify-between p-4">
                  <div>
                    <h3 className="text-md text-gray-900">PDF Agreements</h3>
                    <p className="text-sm text-gray-600">{totalItems} items</p>
                  </div>
                  <Button
                    to="new"
                    role="link"
                    icon="plus"
                    aria-label="new agreement"
                    disabled={
                      !canCreateMoreAgreements
                        ? {
                            reason:
                              "You have reached the limit for creating agreements. Please contact support for information about increasing your limits.",
                          }
                        : false
                    }
                  >
                    Add Agreement
                  </Button>
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
                      {items.map((agreement) => (
                        <ListItem item={agreement} key={agreement.id}>
                          <AgreementRow item={agreement} />
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
    </>
  );
}

function AgreementRow({
  item,
}: {
  item: Pick<
    CustodyAgreement,
    "id" | "name" | "type" | "isDefault" | "isActive"
  >;
}) {
  return (
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
        <AgreementsActionsDropdown agreement={item} />
      </Td>
    </>
  );
}
