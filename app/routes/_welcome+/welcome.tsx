import type { MetaFunction } from "@remix-run/node";
import { ChoosePurpose } from "~/components/welcome/choose-purpose";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Welcome to shelf.nu") },
];

export default function Welcome() {
  return (
    <div>
      <ChoosePurpose />
    </div>
  );
}
