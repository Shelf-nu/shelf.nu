import type { LinksFunction, MetaFunction } from "@remix-run/node";
import { ChoosePlan } from "~/components/welcome/choose-plan";
import carouselStyles from "~/styles/layout/carousel.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const links: LinksFunction = () => [
  {
    rel: "stylesheet",
    href: "https://cdn.jsdelivr.net/npm/swiper@10/swiper-bundle.min.css",
  },
  {
    rel: "stylesheet",
    href: carouselStyles,
  },
];
export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Welcome to shelf.nu") },
];

export default function Welcome() {
  return (
    <div>
      <ChoosePlan />
    </div>
  );
}
