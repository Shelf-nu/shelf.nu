import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAuthSession } from "~/modules/auth";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const title = "Assets Settings";

  return json({ title });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.title) },
];

export const shouldRevalidate = () => false;

export default function AssetsSettings() {
  return <div>Silence is golden</div>;
}
