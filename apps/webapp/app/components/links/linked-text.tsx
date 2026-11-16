/**
 * Text with every http(s) URL inside it turned into a link, the rest left as
 * written: "Manual: https://x.com/a (rev B)" links only "https://x.com/a".
 *
 * @see {@link file://./text-with-links.tsx}
 * @see {@link file://../../../../../packages/links/src/parse.ts} `segmentText`
 */
import { Fragment } from "react";
import { buildCustomFieldLinkHref } from "~/utils/custom-field-link";
import { textRuns } from "./text-runs";

/**
 * Renders `text` with its URLs as anchors opening in a new tab.
 *
 * @param props.text - A custom field value
 */
export function LinkedText({ text }: { text: string }) {
  const runs = textRuns(text);

  return (
    <>
      {runs.map(({ start, segment }) =>
        segment.type === "link" ? (
          <a
            key={start}
            href={buildCustomFieldLinkHref(segment.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline hover:text-gray-500"
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={start}>{segment.text}</Fragment>
        )
      )}
    </>
  );
}
