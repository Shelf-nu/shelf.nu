import type { ChangeEvent } from "react";
import { useFetcher } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import { MarkdownViewer } from "./markdown-viewer";
import Input from "../forms/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/tabs";

interface Props {
  label: string;
  name: string;
  disabled: boolean;
  placeholder?: string;
}

const markdownAtom = atom("");

export const MarkdownEditor = ({ label, name, disabled, placeholder }: Props) => {
  const fetcher = useFetcher();
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
          data-test-id="itemDescription"
        />
      </TabsContent>
      <TabsContent value="preview">
        <MarkdownViewer
          content={content || ""}
          className="min-h-[210px] rounded-lg border px-[14px] py-2"
        />
      </TabsContent>
    </Tabs>
  );
};
