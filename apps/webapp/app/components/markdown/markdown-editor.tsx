import { forwardRef } from "react";
import type { TextareaHTMLAttributes, ChangeEvent } from "react";

import { EditorV2 } from "../editor-v2/editor-v2";

interface Props extends TextareaHTMLAttributes<any> {
  label: string;
  name: string;
  disabled?: boolean;
  placeholder: string;
  defaultValue: string;
  className?: string;
}

export const MarkdownEditor = forwardRef<HTMLTextAreaElement, Props>(
  function MarkdownEditor(props, ref) {
    const { onChange, ...rest } = props;

    return (
      <EditorV2
        {...rest}
        ref={ref}
        onChange={
          onChange
            ? (value) => {
                onChange({
                  target: { value },
                  currentTarget: { value },
                } as unknown as ChangeEvent<HTMLTextAreaElement>);
              }
            : undefined
        }
      />
    );
  }
);
