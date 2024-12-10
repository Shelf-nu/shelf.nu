type Props = {
  truthy: boolean | null | undefined;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export default function When({ truthy, children, fallback }: Props) {
  return truthy ? children : fallback ? fallback : null;
}
