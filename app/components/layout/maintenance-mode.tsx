import { ToolIcon } from "../icons";
import { Button } from "../shared/button";

export default function MaintenanceMode() {
  return (
    <div className="relative h-screen w-screen px-4 py-16 md:p-16">
      <img
        src="/images/bg-overlay1.png"
        alt="background"
        className="absolute left-0 top-0 -z-10 h-full w-full object-cover"
      />
      <div className="flex h-full w-full items-center justify-center bg-white shadow-xl">
        <div className="max-w-[400px] p-6 text-center">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <ToolIcon />
          </div>
          <h1 className="text-[18px] font-semibold leading-7">
            Maintenance is being performed
          </h1>
          <p className="text-gray-600">
            Apologies, we’re down for scheduled maintenance. Please try again
            later.
          </p>
          <Button
            to="https://www.shelf.nu/blog-categories/updates-maintenance"
            target="_blank"
            rel="noopener noreferrer"
            variant="secondary"
            width="full"
            className="mt-8"
          >
            Learn more
          </Button>
        </div>
      </div>
    </div>
  );
}
