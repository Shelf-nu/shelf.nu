import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { ChevronRight } from "~/components/icons";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Badge, Button } from "~/components/shared";
import { Td, Th } from "~/components/table";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";

const bookings = [
  {
    id: 1,
    name: "Untitled booking",
    status: "DRAFT",
    from: null,
    to: null,
    custodian: null,
  },
  {
    id: 2,
    name: "Bit Summit 2024",
    status: "DRAFT",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  },
  {
    id: 3,
    name: "Random convention 2023",
    status: "ACTIVE",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  },
  {
    id: 4,
    name: "Bit Summit 2023",
    status: "ACTIVE",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  },
  {
    id: 5,
    name: "Random convention 2023",
    status: "COMPLETED",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  },
  {
    id: 6,
    name: "Random convention 2022",
    status: "COMPLETED",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  },
  {
    id: 7,
    name: "Random convention 2021",
    status: "COMPLETED",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  },
  {
    id: 8,
    name: "Random convention 2020",
    status: "COMPLETED",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const { prev, next } = generatePageMeta(request);

  // const { locations, totalLocations } = await getLocations({
  //   organizationId,
  //   page,
  //   perPage,
  //   search,
  // });
  // const totalPages = Math.ceil(totalLocations / perPage);

  const header: HeaderData = {
    title: "Bookings",
  };
  const modelName = {
    singular: "booking",
    plural: "bookings",
  };
  return json(
    {
      header,
      items: bookings,
      search,
      page,
      totalItems: bookings.length,
      totalPages: 1,
      perPage,
      prev,
      next,
      modelName,
    },
    {
      headers: [setCookie(await userPrefs.serialize(cookie))],
    }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export default function BookingsIndexPage() {
  const navigate = useNavigate();
  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new booking`}
          data-test-id="createNewBooking"
        >
          New booking
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <List
          ItemComponent={ListAssetContent}
          navigate={(itemId) => navigate(itemId)}
          className=" overflow-x-visible md:overflow-x-auto"
          headerChildren={
            <>
              <Th className="hidden md:table-cell">From</Th>
              <Th className="hidden md:table-cell">To</Th>
              <Th className="hidden md:table-cell">Custodian</Th>
            </>
          }
        />
      </div>
    </>
  );
}

const ListAssetContent = ({ item }: { item: { [key: string]: any } }) => {
  const statusColorMap: { [key: string]: string } = {
    DRAFT: "#667085",
    ACTIVE: "#7A5AF8",
    COMPLETED: "#17B26A",
  };
  return (
    <>
      {/* Item */}
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                {item.name}
              </span>
              <div className="">
                <Badge color={statusColorMap[item.status]}>
                  <span className="block lowercase first-letter:uppercase">
                    {item.status}
                  </span>
                </Badge>
              </div>
            </div>
          </div>

          <button className="block md:hidden">
            <ChevronRight />
          </button>
        </div>
      </Td>
      {/* From */}
      <Td className="hidden md:table-cell">
        {item.from ? (
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {item.from.date}
            </span>
            <span className="block text-gray-600">
              {item.from.day} {item.from.time}
            </span>
          </div>
        ) : null}
      </Td>

      {/* To */}
      <Td className="hidden md:table-cell">
        {item.to ? (
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {item.to.date}
            </span>
            <span className="block text-gray-600">
              {item.to.day} {item.to.time}
            </span>
          </div>
        ) : null}
      </Td>

      {/* Custodian */}
      <Td className="hidden md:table-cell">
        {item.custodian ? (
          <span className="inline-flex w-max items-center justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700">
            <img
              src={"/images/default_pfp.jpg"}
              className="mr-1 h-4 w-4 rounded-full"
              alt=""
            />

            <span className="mt-[1px]">{item.custodian}</span>
          </span>
        ) : null}
      </Td>
    </>
  );
};
