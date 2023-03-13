import type { LinkProps } from "@remix-run/react";

import Heading from "~/components/shared/heading";
import { useCurrentRouteData } from "~/hooks";

import { renderActionFromJson } from "./render-action-from-json";
import Breadcrumbs from "../breadcrumbs";

export type Action = {
  /** Name of the component that should be rendered */
  component: string;
  /** Props to be passed to the component */
  props: LinkProps;

  /** Children to be rendered inside the component */
  children: "+ Create new item";
};

export type HeaderData =
  | {
      title: string;
      actions?: Action[];
    }
  | undefined;

export default function Header() {
  const data = useCurrentRouteData();
  const header = data?.header as HeaderData;

  const actions = header?.actions?.map((action: Action) =>
    renderActionFromJson(action)
  );

  return (
    <header>
      <Breadcrumbs />

      <div className="flex justify-between">
        <Heading as="h2" className="text-display-sm font-semibold">
          {header?.title}
        </Heading>
        <div className="flex gap-3">{actions}</div>
      </div>
    </header>
  );
}
