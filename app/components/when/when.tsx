type Props = {
  truthy: boolean | null | undefined;
  children: React.ReactElement;
};

export default function When({ truthy, children }: Props) {
  return truthy ? children : null;
}
