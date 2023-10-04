import { useEffect, forwardRef } from "react";
import type { TextareaHTMLAttributes, ChangeEvent } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import type { action } from "~/routes/api+/utils.parse-markdown";
import { tw } from "~/utils";
import { MarkdownViewer } from "./markdown-viewer";
import Input from "../forms/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/tabs";

interface Props {
  label: string;
  name: string;
  disabled: boolean;
  placeholder: string;
  defaultValue: string;
  className?: string;
  rest?: TextareaHTMLAttributes<any>;
}

export const markdownAtom = atom("");
export const clearMarkdownAtom = atom(null, (_get, set) =>
  set(markdownAtom, "")
);

export const MarkdownEditor = forwardRef(function MarkdownEditor(
  {
    label,
    name,
    disabled,
    placeholder,
    defaultValue,
    className,
    ...rest
  }: Props,
  ref
) {
  // const sendMagicLink = useTypedFetcher<typeof action>();

  const fetcher = useFetcher<typeof action>();
  const content = fetcher?.data?.content;
  const [markdown, setMarkdown] = useAtom(markdownAtom);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <TabsContent value="edit">
        <Input
          value={markdown}
          onChange={handleChange}
          name={name}
          label={label}
          disabled={disabled}
          inputType="textarea"
          placeholder={placeholder}
          hideLabel
          inputClassName={tw("text-text-md", className)}
          ref={ref}
          {...rest}
        />
        <div className=" rounded-b-lg border border-t-0 border-gray-300 bg-gray-50 px-2 py-1 text-text-xs">
          {" "}
          This field supports{" "}
          <Link
            to="https://www.markdownguide.org/basic-syntax"
            target="_blank"
            className="text-gray-800 underline"
            rel="nofollow noopener noreferrer"
          >
            markdown
          </Link>{" "}
        </div>
      </TabsContent>
      <TabsContent value="preview">
        <MarkdownViewer
          content={content as string}
          className="min-h-[210px] rounded-lg border px-[14px] py-2"
        />
      </TabsContent>
    </Tabs>
  );
});
