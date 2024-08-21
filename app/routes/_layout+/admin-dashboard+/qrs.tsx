import type { PrintBatch, Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { GenerateBatchQr } from "~/components/admin/generate-batch-qr";
import { MarkBatchAsPrinted } from "~/components/admin/mark-batch-as-printed";
import { ErrorContent } from "~/components/errors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Td, Th } from "~/components/table";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import {
  getPaginatedAndFilterableQrCodes,
  markBatchAsPrinted,
} from "~/modules/qr/service.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, parseData } from "~/utils/http.server";
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

    /** We do this to get all the batches ever created so we can have the filter */
    const batches = await db.printBatch.findMany();

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
        batches,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);
    const { batch } = parseData(
      await request.formData(),
      z.object({
        batch: z.string(),
      })
    );

    /** Update the QR codes from the batch as printed */
    await markBatchAsPrinted({ batch });

    return json(
      data({
        success: true,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function Area51() {
  const { totalItems, batches } = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Admin dashboard</h1>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <div className="flex gap-2">
          <GenerateBatchQr />
          <MarkBatchAsPrinted />
        </div>

        <Filters
          slots={{
            "left-of-search": <BatchFilter batches={batches} />,
            "right-of-search": <div>Total codes: {totalItems}</div>,
          }}
        />
        <List
          ItemComponent={ListUserContent}
          hideFirstHeaderColumn
          headerChildren={
            <>
              <Th>QR id</Th>
              <Th>Asset</Th>
              <Th>Kit</Th>
              <Th>Organization ID</Th>
              <Th>User ID</Th>
              <Th>
                <span title="Only available for batched codes">Printed</span>
              </Th>
              <Th>Batch</Th>
              <Th>Created at</Th>
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
      kit: {
        select: {
          id: true;
          name: true;
        };
      };
      organization: {
        select: {
          id: true;
          name: true;
        };
      };
      user: {
        select: {
          id: true;
          email: true;
          firstName: true;
          lastName: true;
        };
      };
      batch: true;
    };
  }>;
}) => (
  <>
    <Td className=" p-0 md:p-0">
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
    <Td className=" whitespace-normal p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.asset ? <span>{item.asset.title}</span> : "N/A"}
      </div>
    </Td>
    <Td className=" whitespace-normal p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.kit ? <span>{item.kit.name}</span> : "N/A"}
      </div>
    </Td>
    <Td className=" p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.organization ? (
          <Link
            target="blank"
            className="underline hover:text-gray-500"
            to={`/admin-dashboard/org/${item.organization.id}`}
          >
            {item.organization.name} ({item.organization.id})
          </Link>
        ) : (
          "N/A"
        )}
      </div>
    </Td>
    <Td className=" p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.user ? (
          <Link
            target="blank"
            className="underline hover:text-gray-500"
            to={`/admin-dashboard/${item.user.id}`}
          >
            {item.user.firstName} {item.user.lastName} ({item.user.email})
            <br /> ({item.user.id})
          </Link>
        ) : (
          "N/A"
        )}
      </div>
    </Td>
    <Td className=" p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item?.batch ? (item.batch.printed ? "Yes" : "No") : "N/A"}
      </div>
    </Td>
    <Td className=" p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item?.batch ? item.batch.name : "N/A"}
      </div>
    </Td>
    <Td className=" p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {String(item.createdAt)}
      </div>
    </Td>
  </>
);

export const ErrorBoundary = () => <ErrorContent />;

function BatchFilter({
  batches,
}: {
  batches: Pick<PrintBatch, "id" | "name" | "printed">[];
}) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const batch = searchParams.get("batch");

  function handleValueChange(value: string) {
    setSearchParams((prev) => {
      /** If the value is "ALL", we just remove the param */
      if (value === "ALL") {
        prev.delete("batch");
        return prev;
      }
      prev.set("batch", value);
      return prev;
    });
  }

  return (
    <div className="w-full md:w-auto">
      <Select
        name={`batch`}
        defaultValue={batch ? batch : "ALL"}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger className="mt-2 px-3.5 py-2 text-left text-base text-gray-500 md:mt-0 md:max-w-fit">
          <SelectValue placeholder={`Filter by batch number`} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[300px] p-0"
          align="start"
        >
          <div className=" max-h-[320px] overflow-auto">
            {["ALL", "No batch", ...batches].map(
              (b) =>
                b && (
                  <SelectItem
                    value={typeof b === "string" ? b : b.id}
                    key={typeof b === "string" ? b : b.id}
                    className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
                  >
                    <span className="mr-4 block text-[14px] lowercase text-gray-700 first-letter:uppercase">
                      {typeof b === "string" ? b : b.name}
                    </span>
                  </SelectItem>
                )
            )}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
