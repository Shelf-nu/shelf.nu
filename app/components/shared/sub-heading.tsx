interface Props {
  children: React.ReactNode;
}

export default function SubHeading({ children }: Props) {
  return <div className="text-text-md text-gray-600 ">{children}</div>;
}
