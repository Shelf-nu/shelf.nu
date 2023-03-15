import type { V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader() {
  const title = "Items Settings";

  return json({ title });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.title) },
];

export default function ItemsSettings() {
  return <div>Silence is golden</div>;
}
