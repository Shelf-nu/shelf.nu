import type { ButtonProps } from "~/components/shared/button";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";

export const ClearSearch = ({
  buttonProps,
  children,
}: {
  buttonProps?: ButtonProps;
  children?: string;
}) => {
  const [, setSearchParams] = useSearchParams();
  return (
    <Button
      to="."
      {...buttonProps}
      onClick={() => {
        setSearchParams((prev) => {
          prev.delete("s");

          return prev;
        });
      }}
    >
      {children}
    </Button>
  );
};
