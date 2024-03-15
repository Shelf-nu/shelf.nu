import { Button } from "~/components/shared";

/** This route is meant for handling 404 errors for logged in users  */
export default function LayoutSplat() {
  return (
    <div className="flex size-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <img src="/images/error-icon.svg" alt="" className="mb-5" />
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
