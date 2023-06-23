import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getAllPaginatedAndFilretableAssets } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);

  const data = await getAllPaginatedAndFilretableAssets({
    request,
    userId,
  });
  return json({ showModal: true, ...data });
};

export default function AddAssetsToLocation() {
  const { assets } = useLoaderData();
  console.log(assets);
  return (
    <div>
      <header>
        <h2>Move assets to ‘Gear Room III’ location</h2>
        <p>
          Search your database for assets that you would like to move to this
          location.
        </p>
      </header>
    </div>
  );
}
