
import Heading from "~/components/shared/heading";
import { useCurrentRouteData } from "~/hooks";

import { renderActionFromJson } from "./render-action-from-json";
import type { Action, HeaderData } from "./types";
import Breadcrumbs from "../breadcrumbs";


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
