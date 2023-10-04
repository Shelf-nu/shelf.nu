type Props = {
  truthy: boolean;
  children: React.ReactElement;
};

export default function When({ truthy, children }: Props) {
  return truthy ? children : null;
}
