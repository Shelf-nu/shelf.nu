import React from "react";
import {
  Form as RemixForm,
  type FormProps as RemixFormProps,
} from "react-router";
import { scrollToError } from "~/utils/scroll-to-error";

export const Form = React.forwardRef<HTMLFormElement, RemixFormProps>(
  (props, ref) => (
    <RemixForm
      ref={ref}
      {...props}
      onSubmit={(event) => {
        /** Scroll to the error if there are any */
        scrollToError(event);
        /** Invoke the onSubmit function coming from props */
        props?.onSubmit?.(event);
      }}
    />
  )
);

Form.displayName = "Form";
