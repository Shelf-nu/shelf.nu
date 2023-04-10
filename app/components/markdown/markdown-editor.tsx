import { renderers } from "@markdoc/markdoc";
import { ThemeProvider } from "@primer/react";
import { MarkdownEditor as GhMarkdownEditor } from "@primer/react/drafts";
import { useFetcher } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import { ClientOnly } from "remix-utils";

interface Props {
  label: string;
  name: string;
  disabled: boolean;
}

const markdownAtom = atom("");

export const MarkdownEditor = ({ label, name, disabled, ...rest }: Props) => {
  const fetcher = useFetcher();
  const content = fetcher?.data?.content;
  const [markdown, setMarkdown] = useAtom(markdownAtom);

  const handleChange = (newMarkdown: string) => {
    setMarkdown(newMarkdown);
    fetcher.submit(
      { content: newMarkdown },
      { method: "post", action: "/api/utils/parse-markdown" }
    );
  };

  return (
    <ClientOnly>
      {() => (
        <ThemeProvider>
          <div className="w-full">
            <GhMarkdownEditor
              value={markdown}
              onChange={handleChange}
              onRenderPreview={async () => renderers.html(content)}
              name={name}
              disabled={disabled}
              {...rest}
            >
              {label ? (
                <GhMarkdownEditor.Label visuallyHidden>
                  {label}
                </GhMarkdownEditor.Label>
              ) : null}
            </GhMarkdownEditor>
          </div>
        </ThemeProvider>
      )}
    </ClientOnly>
  );
};
