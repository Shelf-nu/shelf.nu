import { useState } from "react";
import { isRouteErrorResponse, useLocation, useRouteError } from "react-router";

import { Check, Copy } from "lucide-react";
import { isRouteError } from "~/utils/http";
import { tw } from "~/utils/tw";
import Error404Handler from "./error-404-handler";
import { parse404ErrorData } from "./utils";
import { Button } from "../shared/button";

type ErrorContentProps = { className?: string };

export const ErrorContent = ({ className }: ErrorContentProps) => {
  const loc = useLocation();
  const response = useRouteError();

  let title = "Oops, something went wrong";
  let message =
    "There was an unexpected error. Please refresh to try again. If the issues persists, please contact support.";
  let traceId;

  if (isRouteError(response)) {
    message = response.data.error.message;
    title = response.data.error.title || "Oops, something went wrong";
    traceId = response.data.error.traceId;
  }

  const error404 = parse404ErrorData(response);
  if (error404.isError404) {
    return (
      <Error404Handler
        className={className}
        additionalData={error404.additionalData}
      />
    );
  }

  // Creating a string with <br/> tags for line breaks
  const messageHtml = { __html: message.split("\n").join("<br/>") };

  const errorDetails =
    response instanceof Error
      ? `${response.message}\n${response.stack}`
      : isRouteErrorResponse(response)
      ? JSON.stringify(response, null, 2)
      : null;

  return (
    <div
      className={tw(
        "flex size-full h-dvh items-center justify-center",
        className
      )}
    >
      <div className="flex flex-col items-center text-center">
        <span className="mb-5 size-14 text-primary">
          <ErrorIcon />
        </span>
        <h2 className="mb-2">{title}</h2>
        <p className="max-w-[550px]" dangerouslySetInnerHTML={messageHtml} />
        {traceId && <p className="text-gray-400">(Trace id: {traceId})</p>}
        <div className=" mt-8 flex gap-3">
          <Button to="/" variant="secondary" icon="home">
            Back to home
          </Button>
          <Button to={loc.pathname} reloadDocument>
            Reload page
          </Button>
        </div>
        {errorDetails && (
          <details className="mt-8 w-full max-w-[550px]">
            <summary className="cursor-pointer text-sm text-gray-500">
              Error details (for support)
            </summary>
            <div className="relative mt-2">
              <CopyButton text={errorDetails} />
              <pre className="max-h-[200px] overflow-auto rounded bg-gray-100 p-3 pr-10 text-left text-xs text-gray-700">
                {errorDetails}
              </pre>
            </div>
          </details>
        )}
      </div>
    </div>
  );
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      title="Copy to clipboard"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}

export const ErrorIcon = () => (
  <svg
    width="56px"
    height="56px"
    viewBox="0 0 56 56"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M56 0H0V56H56V0Z" fill="currentColor" />
    <rect x="11.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect x="18.9" y="32.375" width="4.2" height="11.375" fill="white" />
    <rect x="25.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect x="32.9" y="30.625" width="4.2" height="13.125" fill="white" />
    <rect x="39.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect
      x="11.375"
      y="25.375"
      width="5.25"
      height="8.75"
      fill="currentColor"
    />
    <rect
      x="39.375"
      y="25.375"
      width="5.25"
      height="9.625"
      fill="currentColor"
    />
    <rect x="32" y="25" width="6" height="7" fill="currentColor" />
    <rect x="25" y="25" width="7" height="6" fill="currentColor" />
    <rect
      x="14"
      y="20.125"
      width="4.375"
      height="6.125"
      transform="rotate(-90 14 20.125)"
      fill="white"
    />
    <rect
      x="36.75"
      y="20.125"
      width="4.375"
      height="5.25"
      transform="rotate(-90 36.75 20.125)"
      fill="white"
    />
  </svg>
);
