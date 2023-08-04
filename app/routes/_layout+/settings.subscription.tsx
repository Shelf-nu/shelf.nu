import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";

import { assertIsPost } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function action({ request }: ActionArgs) {
  await requireAuthSession(request);
  assertIsPost(request);

  return null;
}

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return json({
    title: "Subscription",
    subTitle: "Pick an account plan that fits your workflow.",
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function UserPage() {
  const { title, subTitle } = useLoaderData<typeof loader>();
  return (
    <div className=" flex flex-col">
      <div className="mb-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">{title}</h3>
          <p className="text-sm text-gray-600">{subTitle}</p>
        </div>
      </div>
    </div>
  );
}
