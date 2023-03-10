import { Link } from "@remix-run/react/";

import type { RemixLinkProps } from "@remix-run/react/dist/components";
import Heading from "~/components/shared/heading";
import { useCurrentRouteData } from "~/hooks";

import Breadcrumbs from "../breadcrumbs";

/** An action is an object that descibes one of the actions that will be
 * rendered on the right side of the screen, next to the title.
 * An action will always render Remix's <Link/> component
 * */
interface Action {
  /** Link props */
  props: RemixLinkProps;

  /** Children to be rendered inside the link component */
  children: JSX.Element | string;
}

export type HeaderData =
  | {
      title: string;
      actions?: Action[];
    }
  | undefined;

export default function Header() {
  const data = useCurrentRouteData();
  const header = data?.header as HeaderData;
  return (
    <header>
      <Breadcrumbs />

      <div className="flex justify-between">
        <Heading as="h2" className="text-display-sm font-semibold">
          {header?.title}
        </Heading>
        {header?.actions?.map((action, index) => (
          <Link {...action.props} key={index}>
            {action.children}
          </Link>
        ))}
      </div>
    </header>
  );
}
