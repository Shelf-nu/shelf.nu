import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/node";
import WelcomeCarousel from "~/components/welcome/carousel";
import { requireAuthSession } from "~/modules/auth";
import carouselStyles from "~/styles/layout/carousel.css";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAuthSession(request);
  return null;
};

export default function Welcome() {
  return (
    <div>
      <WelcomeCarousel />
    </div>
  );
}
