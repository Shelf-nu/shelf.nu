import type { LoaderArgs } from "@remix-run/node";

import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return null;
}

export default function ItemIndexPage() {
  return (
    <>
      <p>No item selected. Select a item on the left, or </p>
    </>
  );
}
