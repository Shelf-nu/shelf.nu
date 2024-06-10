import React from "react";
import {
  Form as RemixForm,
  FormProps as RemixFormProps,
} from "@remix-run/react";
import { scrollToError } from "~/utils/scroll-to-error";

type HTMLFormMethod = "post" | "get" | undefined;
type HTMLFormEncType =
  | "application/x-www-form-urlencoded"
  | "multipart/form-data"
  | "text/plain"
  | undefined;

interface CustomFormProps
  extends Omit<React.ComponentPropsWithoutRef<"form">, "method" | "onSubmit"> {
  method?: HTMLFormMethod;
  encType?: HTMLFormEncType;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  replace?: boolean;
}

export const CustomForm = React.forwardRef<HTMLFormElement, CustomFormProps>(
  (props, ref) => <RemixForm ref={ref} {...props} onSubmit={scrollToError} />
);

CustomForm.displayName = "CustomForm";
