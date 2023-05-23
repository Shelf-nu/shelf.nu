interface Props {
  children: React.ReactNode;
  className?: string;
}

export default function SubHeading({ children, className }: Props) {
  return (
    <div
      className={`text-text-sm font-normal text-gray-500 md:text-text-md ${className}`}
    >
      {children}
    </div>
  );
}
