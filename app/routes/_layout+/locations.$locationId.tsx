import {
  json,
  type LinksFunction,
  type LoaderArgs,
  type V2_MetaFunction,
} from "@remix-run/node";
import mapCss from "maplibre-gl/dist/maplibre-gl.css";
import type { HeaderData } from "~/components/layout/header/types";
import { requireAuthSession } from "~/modules/auth";
import { getLocation } from "~/modules/location";
import { getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const loader = async ({ request, params }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);
  const id = getRequiredParam(params, "locationId");
  const location = await getLocation({ userId, id });
  if (!location) {
    throw new Response("Not Found", { status: 404 });
  }
  const header: HeaderData = {
    title: location.name,
  };

  return json({ location, header });
};

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export const handle = {
  breadcrumb: () => "single",
};

export const links: LinksFunction = () => [{ rel: "stylesheet", href: mapCss }];

export default function LocationPage() {
  return (
    <div>
      <h1>Location</h1>
    </div>
  );
}
