import { useEffect, forwardRef, useState } from "react";
import type { TextareaHTMLAttributes, ChangeEvent } from "react";
import { Link, useFetcher } from "@remix-run/react";
import type { action } from "~/routes/api+/utils.parse-markdown";
import { tw } from "~/utils/tw";
import { MarkdownViewer } from "./markdown-viewer";
import Input from "../forms/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/tabs";

interface Props extends TextareaHTMLAttributes<any> {
  label: string;
  name: string;
  disabled?: boolean;
  placeholder: string;
  defaultValue: string;
  className?: string;
}

export const MarkdownEditor = forwardRef(function MarkdownEditor(
  {
    label,
    name,
    disabled,
    placeholder,
    defaultValue,
    className,
    maxLength = 5000,
    ...rest
  }: Props,
  ref
) {
  const fetcher = useFetcher<typeof action>();
  const content = fetcher.data?.error ? "" : fetcher.data?.content;
  const [markdown, setMarkdown] = useState<string>("");

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const content = e.currentTarget.value;
    setMarkdown(content);
  };

  const handlePreviewChange = (value: string) => {
    if (value === "preview") {
      fetcher.submit(
        { content: markdown },
        { method: "post", action: "/api/utils/parse-markdown" }
      );
    }
  };

  useEffect(() => {
    setMarkdown(defaultValue);
  }, [defaultValue]);

  return (
    <Tabs
      defaultValue="edit"
      className="w-full"
      onValueChange={handlePreviewChange}
    >
      <TabsList>
        <TabsTrigger value="edit">Edit</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>

      {/* Having this hidden input so that the value persists even if the tab changes */}
      <input name={name} value={markdown} type="hidden" disabled={disabled} />

      <TabsContent value="edit">
        <Input
          value={markdown}
          onChange={handleChange}
          label={label}
          disabled={disabled}
          inputType="textarea"
          placeholder={placeholder}
          hideLabel
          inputClassName={tw("text-text-md", className)}
          ref={ref}
          maxLength={maxLength}
          {...rest}
        />
        <div className="flex items-center justify-between gap-2 rounded-b border border-t-0 border-gray-300 bg-gray-50 px-2 py-1 text-text-xs">
          <p>
            This field supports{" "}
            <Link
              to="https://www.markdownguide.org/basic-syntax"
              target="_blank"
              className="text-gray-800 underline"
              rel="nofollow noopener noreferrer"
            >
              markdown
            </Link>
          </p>
          {maxLength ? (
            <p>
              {markdown.length}/{maxLength}
            </p>
          ) : null}
        </div>
      </TabsContent>
      <TabsContent value="preview">
        <MarkdownViewer
          content={content as string}
          className="min-h-[210px] rounded border px-[14px] py-2"
        />
      </TabsContent>
    </Tabs>
  );
});
