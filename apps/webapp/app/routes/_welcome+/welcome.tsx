import { redirect, type MetaFunction } from "react-router";
import { ChoosePurpose } from "~/components/welcome/choose-purpose";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Welcome to shelf.nu") },
];

export function loader() {
  if (!ENABLE_PREMIUM_FEATURES) {
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
