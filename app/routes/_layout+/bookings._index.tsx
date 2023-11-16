import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared";
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
      // items: locations,
      search,
      page,
      // totalItems: totalLocations,
      // totalPages,
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
        List bookings
        {/* <List
          ItemComponent={ListItemContent}
          navigate={(itemId) => navigate(itemId)}
          headerChildren={
            <>
              <Th>Assets</Th>
            </>
          }
        /> */}
      </div>
    </>
  );
}
