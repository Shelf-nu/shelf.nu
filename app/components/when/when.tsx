type Props = {
  truthy: boolean;
  elseElement?: React.ReactNode;
};

export default function When({
  truthy,
  children,
  elseElement,
}: React.PropsWithChildren<Props>): React.ReactNode | null {
  if (truthy) {
    return children;
  }

  if (typeof elseElement === "undefined") {
    return null;
  }

  return elseElement;
}
