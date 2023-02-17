import { LoaderArgs, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";
import { getItems } from "~/modules/item";
import { notFound } from "~/utils";

export async function loader({ request }: LoaderArgs) {
  const { userId, email } = await requireAuthSession(request);

  const items = await getItems({ userId });

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  return json({ email, items });
}

export default function ItemIndexPage() {
  const data = useLoaderData<typeof loader>();
  console.log(data);
  return (
    <>
      <p>
        No item selected. Select a item on the left, or{" "}
        <Link to="new" className="text-blue-500 underline">
          create a new item.
        </Link>
      </p>
    </>
  );
}
