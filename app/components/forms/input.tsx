interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  /** Error message */
  error?: string;
}

export default function Input({ className, error, ...rest }: Props) {
  return (
    <>
      <input
        className={`rounded border border-gray-500 px-2 py-1 ${className}`}
        {...rest}
      />
      {error && <div className="pt-1 text-sm text-red-700">{error}</div>}
    </>
  );
}
