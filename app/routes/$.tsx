import { ErrorIcon } from "~/components/errors";
import { Button } from "~/components/shared/button";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("Not found") }];

export default function LayoutSplat() {
  return (
    <div className="flex size-full h-screen items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <span className="mb-5 size-[56px] text-primary">
          <ErrorIcon />
        </span>
        <h2 className="mb-2">Page not found</h2>
        <p className="max-w-[550px]">
          We couldn't find the page you were looking for.
        </p>

        <div className=" mt-8 flex gap-3">
          <Button to="/" variant="secondary" icon="home">
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}
