type Props = {
  truthy: boolean | null | undefined;
  children: React.ReactNode;
};

export default function When({ truthy, children }: Props) {
  return truthy ? children : null;
}
