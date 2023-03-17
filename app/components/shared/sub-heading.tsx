interface Props {
  children: React.ReactNode;
  className?: string;
}

export default function SubHeading({ children, className }: Props) {
  return (
    <div className={`text-text-md font-normal text-gray-500 ${className}`}>
      {children}
    </div>
  );
}
