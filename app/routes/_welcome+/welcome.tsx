import { redirect, type MetaFunction } from "@remix-run/node";
import { ChoosePurpose } from "~/components/welcome/choose-purpose";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ENABLE_PREMIUM_FEATURES, NODE_ENV } from "~/utils/env";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Welcome to shelf.nu") },
];

export function loader() {
  if (
    (NODE_ENV !== "test" || process.env.CI !== "true") &&
    !ENABLE_PREMIUM_FEATURES
  ) {
    return redirect("/assets");
  }
  return null;
}

export default function Welcome() {
  return (
    <div>
      <ChoosePurpose />
    </div>
  );
}
