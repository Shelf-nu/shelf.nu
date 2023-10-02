type Props = {
  truthy: boolean;
  elseElement?: React.ReactNode;
};

export default function When({
  truthy,
  children,
  elseElement,
}: React.PropsWithChildren<Props>) {
  return truthy ? children : elseElement ?? null;
}
