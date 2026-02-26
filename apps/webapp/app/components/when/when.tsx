import type { ReactNode } from "react";

type Props = {
  truthy: boolean | null | undefined;
  children: ReactNode;
  fallback?: ReactNode;
};

export default function When({ truthy, children, fallback }: Props) {
  return truthy ? children : fallback ? fallback : null;
}
