import { useLoaderData } from "@remix-run/react";
import Heading from "~/components/shared/heading";
import SubHeading from "~/components/shared/sub-heading";

import type { HeaderData } from "./types";

export default function Header({ children }: { children?: React.ReactNode }) {
  const data = useLoaderData();
  const header = data?.header as HeaderData;

  return (
    <header>
      <div className="flex justify-between">
        <div>
          <Heading as="h2" className="text-display-sm font-semibold">
            {header?.title}
          </Heading>
          {header?.subHeading && <SubHeading>{header.subHeading}</SubHeading>}
        </div>

        <div className="flex gap-3">{children}</div>
      </div>
    </header>
  );
}
