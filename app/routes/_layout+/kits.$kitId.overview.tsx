import type { Asset, Barcode } from "@prisma/client";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { CategoryBadge } from "~/components/assets/category-badge";
import { BarcodeCard } from "~/components/barcode/barcode-card";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import When from "~/components/when/when";
import { getKitOverviewFields } from "~/modules/kit/fields";
import { getKit } from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint, getDateTimeFormat } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import { makeShelfError } from "~/utils/error";
import { error, getParams, data } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { requirePermission } from "~/utils/roles.server";

type KitWithOptionalBarcodes = ReturnType<
  typeof useLoaderData<typeof loader>
>["kit"] & {
  barcodes?: Pick<Barcode, "id" | "type" | "value">[];
  assets?: Pick<Asset, "valuation">[];
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId: id } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const {
      organizationId,
      userOrganizations,
      canUseBarcodes,
      currentOrganization,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });
    const { locale } = getClientHint(request);

    const kit = await getKit({
      id,
      organizationId,
      userOrganizations,
      request,
      extraInclude: getKitOverviewFields(canUseBarcodes),
    });

    const header: HeaderData = {
      title: `${kit.name}'s overview`,
    };

    return json(
      data({
        kit: {
          ...kit,
          createdAt: getDateTimeFormat(request, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(kit.createdAt),
        },
        currentOrganization,
        locale,
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Overview",
};

export default function KitOverview() {
  const { kit, currentOrganization, locale } = useLoaderData<typeof loader>();
  const { canUseBarcodes } = useBarcodePermissions();
  const totalValue =
    ("assets" in kit &&
      kit?.assets?.reduce(
        (total, asset) => total + (asset.valuation ?? 0),
        0
      )) ||
    0;

  return (
    <Card className="mt-0 px-[-4] py-[-5] md:border">
      <ul className="item-information">
        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 dark:border-b-color-200 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-color-900">
            ID
          </span>
          <div className="mt-1 w-3/5 text-color-600 md:mt-0">{kit?.id}</div>
        </li>
        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 dark:border-b-color-200 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-color-900">
            Created
          </span>
          <div className="mt-1 w-3/5 text-color-600 md:mt-0">
            {kit && kit.createdAt}
          </div>
        </li>

        {kit?.description ? (
          <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 dark:border-b-color-200 md:flex">
            <span className="w-1/4 text-[14px] font-medium text-color-900">
              Description
            </span>
            <div className="mt-1 whitespace-pre-wrap text-color-600 md:mt-0 md:w-3/5">
              {kit.description}
            </div>
          </li>
        ) : null}

        <When truthy={!!kit.category}>
          <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 dark:border-b-color-200 md:flex">
            <span className="w-1/4 text-[14px] font-medium text-color-900">
              Category
            </span>
            <div className="mt-1 whitespace-pre-wrap text-color-600 md:mt-0 md:w-3/5">
              <CategoryBadge category={kit.category} />
            </div>
          </li>
        </When>

        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 dark:border-b-color-200 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-color-900">
            Total value{" "}
            <InfoTooltip
              iconClassName="size-4"
              content={
                <>
                  <h6>Total value</h6>
                  <p>
                    A sum of all assets' values in this kit. If no assets are
                    present, this will be zero.
                  </p>
                </>
              }
            />
          </span>
          <div className="mt-1 whitespace-pre-wrap text-color-600 md:mt-0 md:w-3/5">
            {formatCurrency({
              value: totalValue,
              locale,
              currency: currentOrganization.currency,
            })}
          </div>
        </li>

        {(() => {
          const kitWithBarcodes = kit as KitWithOptionalBarcodes;
          return (
            kit &&
            kitWithBarcodes.barcodes?.length &&
            kitWithBarcodes.barcodes.length > 0 &&
            canUseBarcodes
          );
        })() ? (
          <li className="w-full p-4 last:border-b-0 md:block">
            <span className="mb-3 flex items-center gap-1 text-[14px] font-medium text-color-900">
              Barcodes ({(kit as KitWithOptionalBarcodes).barcodes?.length})
              <InfoTooltip
                iconClassName="size-4"
                content={
                  <>
                    <h6>Barcodes support</h6>
                    <p>
                      Want to know more about barcodes? Check out our knowledge
                      base article on{" "}
                      <Button
                        variant="link"
                        target="_blank"
                        to="https://www.shelf.nu/knowledge-base/alternative-barcodes"
                      >
                        barcode support
                      </Button>
                    </p>
                  </>
                }
              />
            </span>
            <div className="flex flex-wrap gap-3">
              {(kit as KitWithOptionalBarcodes).barcodes?.map((barcode) => (
                <BarcodeCard key={barcode.id} barcode={barcode} />
              ))}
            </div>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
