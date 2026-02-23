import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const loader = (_: LoaderFunctionArgs) => redirect("/home", 301);

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Home") },
];

export default function DashboardRedirect() {
  return null;
}
