import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { AddAssetForm } from "~/components/location/add-asset-form";
import { db } from "~/database";
import { getPaginatedAndFilterableAssets } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { assertIsPost } from "~/utils";

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);

  const data = await getPaginatedAndFilterableAssets({
    request,
    userId,
  });
  return json({
    showModal: true,
    ...data,
  });
};

export const action = async ({ request, params }: ActionArgs) => {
  assertIsPost(request);
  await requireAuthSession(request);
  const { locationId } = params;
  const formData = await request.formData();
  const assetId = formData.get("assetId") as string;
  const isChecked = formData.get("isChecked") === "yes";

  const location = await db.location.update({
    where: {
      id: locationId,
    },
    data: {
      assets: isChecked
        ? { connect: { id: assetId } }
        : { disconnect: { id: assetId } },
    },
  });

  if (!location) {
    throw new Response("Something went wrong", { status: 500 });
  }

  return json({ ok: true });
};

export default function AddAssetsToLocation() {
  const { assets } = useLoaderData<typeof loader>();
  const { locationId } = useParams();

  return (
    <div>
      <header>
        <h2>Move assets to ‘Gear Room III’ location</h2>
        <p>
          Search your database for assets that you would like to move to this
          location.
        </p>
      </header>
      <div>
        {assets.map((asset) => (
          <div key={asset.id} className="flex justify-between border p-4">
            <p>{asset.title}</p>
            <AddAssetForm
              assetId={asset.id}
              isChecked={asset.locationId === locationId || false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
