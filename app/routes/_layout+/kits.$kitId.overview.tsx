import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { BarcodeCard } from "~/components/barcode/barcode-card";
import type { HeaderData } from "~/components/layout/header/types";
import { Card } from "~/components/shared/card";
import { getKitOverviewFields } from "~/modules/kit/fields";
import { getKit } from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getDateTimeFormat } from "~/utils/client-hints";
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
  barcodes?: Array<{
    id: string;
    type: any;
    value: string;
  }>;
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId: id } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations, canUseBarcodes } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.kit,
        action: PermissionAction.read,
      });

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
  const { kit } = useLoaderData<typeof loader>();
  const { canUseBarcodes } = useBarcodePermissions();

  return (
    <Card className="mt-0 px-[-4] py-[-5] md:border">
      <ul className="item-information">
        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-gray-900">
            ID
          </span>
          <div className="mt-1 w-3/5 text-gray-600 md:mt-0">{kit?.id}</div>
        </li>
        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-gray-900">
            Created
          </span>
          <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
            {kit && kit.createdAt}
          </div>
        </li>

        {kit?.description ? (
          <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
            <span className="w-1/4 text-[14px] font-medium text-gray-900">
              Description
            </span>
            <div className="mt-1 whitespace-pre-wrap text-gray-600 md:mt-0 md:w-3/5">
              {kit.description}
            </div>
          </li>
        ) : null}

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
            <span className="mb-3 block text-[14px] font-medium text-gray-900">
              Barcodes ({(kit as KitWithOptionalBarcodes).barcodes?.length})
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
