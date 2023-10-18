import type { LinksFunction } from "@remix-run/node";
import WelcomeCarousel from "~/components/welcome/carousel";
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

export default function Welcome() {
  return (
    <div className="rounded-xl bg-white">
      <WelcomeCarousel />
    </div>
  );
}
