import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { data } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import {
  getLocation,
  getLocationTotalValuation,
} from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ locationId: z.string() });

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId: id } = getParams(params, paramsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.location,
        action: PermissionAction.read,
      });

    const { locale } = getClientHint(request);
    const { location } = await getLocation({
      id,
      organizationId,
      userOrganizations,
      request,
    });
    const totalValue = await getLocationTotalValuation({ locationId: id });

    const header: HeaderData = {
      title: `${location.name}'s overview`,
    };

    return payload({
      location,
      totalValue,
      locale,
      currentOrganization,
      header,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId: id });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Overview",
};

export default function LocationOverview() {
  const { location, totalValue, locale, currentOrganization } =
    useLoaderData<typeof loader>();
  return (
    <Card className="mt-0 px-[-4] py-[-5] md:border">
      <ul className="item-information">
        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-gray-900">
            ID
          </span>
          <div className="mt-1 w-3/5 text-gray-600 md:mt-0">{location.id}</div>
        </li>
        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-gray-900">
            Created
          </span>
          <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
            <DateS
              date={location.createdAt}
              options={{ dateStyle: "short", timeStyle: "short" }}
            />
          </div>
        </li>
        {location.address && (
          <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
            <span className="w-1/4 text-[14px] font-medium text-gray-900">
              Address
            </span>
            <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
              {location.address}
            </div>
          </li>
        )}
        {location.description && (
          <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
            <span className="w-1/4 text-[14px] font-medium text-gray-900">
              Description
            </span>
            <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
              {location.description}
            </div>
          </li>
        )}
        <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
          <span className="w-1/4 text-[14px] font-medium text-gray-900">
            Total value{" "}
            <InfoTooltip
              iconClassName="size-4"
              content={
                <>
                  <h6>Total value</h6>
                  <p>
                    A sum of all assets' values stored at this location. If no
                    assets are present, this will be zero.
                  </p>
                </>
              }
            />
          </span>
          <div className="mt-1 whitespace-pre-wrap text-gray-600 md:mt-0 md:w-3/5">
            {formatCurrency({
              value: totalValue,
              locale,
              currency: currentOrganization.currency,
            })}
          </div>
        </li>
      </ul>
    </Card>
  );
}
