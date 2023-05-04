import { UnlinkIcon } from "~/components/icons";
import { Button } from "~/components/shared";

export default function UnlinkedQrBelognsToUser() {
  return (
    <>
      <div className="flex flex-1 justify-center py-8">
        <div className="my-auto">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <UnlinkIcon />
          </div>
          <div className="mb-8">
            <h1 className="mb-2 text-[24px] font-semibold">Unlinked QR Code</h1>
            <p>
              This code is part of your Shelf environment but is not linked with
              an item. Would you like to link it?
            </p>
          </div>
          <div className="flex flex-col justify-center">
            <Button variant="primary" className="mb-4 max-w-full" to={"."}>
              Create a new item and link
            </Button>
            <Button variant="secondary" className="mb-4 max-w-full" to={"."}>
              Link with existing item
            </Button>
            <Button variant="secondary" className="max-w-full" to={"."}>
              No, Take me back
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-6 text-center text-sm text-gray-500">
        Don't have an account?{" "}
        <Button
          variant="link"
          data-test-id="signupButton"
          to={{
            pathname: "/join",
          }}
        >
          Sign up
        </Button>
      </div>
    </>
  );
}
