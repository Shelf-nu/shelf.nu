import { Form } from "@remix-run/react";
import type { ButtonProps } from "~/components/shared/button";
import { Button } from "~/components/shared/button";

export const ClearSearchForm = ({
  buttonProps,
  buttonContent,
}: {
  /** Props to be passed to the button */
  buttonProps?: ButtonProps;
  /** text for inside the button */
  buttonContent: string;
}) => (
  <Form>
    <input type="hidden" name="s" value="" />
    <Button name="intent" value="clearSearch" {...buttonProps}>
      {buttonContent}
    </Button>
  </Form>
);
