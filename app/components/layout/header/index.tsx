import type { ReactNode } from "react";
import Heading from "~/components/shared/heading";

interface Props {
  title: ReactNode | string;
  actions?: () => JSX.Element;
}

export default function Header({ title, actions }: Props) {
  return (
    <header>
      <div className="flex justify-between">
        <Heading as="h2" className="text-display-sm font-semibold">
          {title}
        </Heading>

        {actions && actions()}
      </div>
    </header>
  );
}
