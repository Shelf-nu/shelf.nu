import type { ButtonProps } from "~/components/shared/button";
import { Button } from "~/components/shared/button";

export const ClearSearch = ({
  buttonProps,
  children,
}: {
  buttonProps?: ButtonProps;
  children?: string;
}) => (
  <Button to="." {...buttonProps}>
    {children}
  </Button>
);
