import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Pagination } from "~/components/list/pagination";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import { getPaginatedAndFilterableQrCodes } from "~/modules/qr/service.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const { search, totalQrCodes, perPage, page, qrCodes, totalPages } =
      await getPaginatedAndFilterableQrCodes({
        request,
      });

    if (page > totalPages) {
      return redirect("/admin-dashboard");
    }

    const header: HeaderData = {
      title: `Admin dashboard - QR codes`,
    };

    const modelName = {
      singular: "qr",
      plural: "qrs",
    };

    return json(
      data({
        header,
        items: qrCodes,
        search,
        page,
        totalItems: totalQrCodes,
        perPage,
        totalPages,
        modelName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function Area51() {
  const { totalItems } = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Admin dashboard</h1>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <Button
          to={`/admin-dashboard/qrs/codes.zip?${new URLSearchParams({
            amount: "1000",
          })}`}
          reloadDocument
          download
          variant="secondary"
          name="intent"
          value="createOrphans"
        >
          Generate & Download unclaimed QR codes batch
        </Button>
        <p className="mt-2 text-sm text-gray-500">
          Generates and downloads a batch of 1000 unclaimed qr codes
        </p>

        <div>Total codes: {totalItems}</div>
        <Filters>
          <Pagination />
        </Filters>
        <List
          ItemComponent={ListUserContent}
          hideFirstHeaderColumn
          headerChildren={
            <>
              <Th className="hidden md:table-cell">QR id</Th>
              <Th className="hidden md:table-cell">Asset</Th>
              <Th className="hidden md:table-cell">Organization ID</Th>
              <Th className="hidden md:table-cell">User ID</Th>
              <Th className="hidden md:table-cell">Printed</Th>
              <Th className="hidden md:table-cell">Batch</Th>
            </>
          }
        />
      </div>
    </div>
  );
}

const ListUserContent = ({
  item,
}: {
  item: Prisma.QrGetPayload<{
    include: {
      asset: {
        select: {
          id: true;
          title: true;
        };
      };
    };
  }>;
}) => (
  <>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        <Link
          target="blank"
          className="underline hover:text-gray-500"
          to={`/qr/${item.id}`}
        >
          {item.id}
        </Link>
      </div>
    </Td>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.asset ? (
          <span>
            {item.asset.title} ({item.asset.id})
          </span>
        ) : (
          "N/A"
        )}
      </div>
    </Td>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.organizationId ? (
          <Link
            target="blank"
            className="underline hover:text-gray-500"
            to={`/admin-dashboard/org/${item.organizationId}`}
          >
            {item.organizationId}
          </Link>
        ) : (
          "N/A"
        )}
      </div>
    </Td>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.userId ? (
          <Link
            target="blank"
            className="underline hover:text-gray-500"
            to={`/admin-dashboard/${item.userId}`}
          >
            {item.userId}
          </Link>
        ) : (
          "N/A"
        )}
      </div>
    </Td>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.printed ? "Yes" : "No"}
      </div>
    </Td>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.batch || "N/A"}
      </div>
    </Td>
  </>
);

export const ErrorBoundary = () => <ErrorContent />;
