import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export const loader = async ({ request }: LoaderArgs) =>
  json({ showModal: true });

export default function AddAssetsToLocation() {
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
