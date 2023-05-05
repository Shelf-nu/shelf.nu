import { SadFaceIcon } from "~/components/icons";
import { Button } from "~/components/shared";
export const QrNotFound = () => (
  <>
    <div className="flex flex-1 justify-center py-8">
      <div className="my-auto">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
          <SadFaceIcon />
        </div>
        <div className="mb-8">
          <h1 className="mb-2 text-[24px] font-semibold">Code Not Found</h1>
          <p className="text-gray-600">
            This QR code is not found in our database. Make sure the code you
            are scanning is registered by a Shelf user.
          </p>
        </div>
        <ul className="useful-links">
          <li>
            <Button
              variant="link"
              className="mb-3 text-text-md font-normal text-gray-600 underline"
              to={{ pathName: "#" }}
            >
              Useful link 1
            </Button>
          </li>
          <li>
            <Button
              variant="link"
              className="mb-3 text-text-md font-normal text-gray-600 underline"
              to={{ pathName: "#" }}
            >
              Useful link 2
            </Button>
          </li>
          <li>
            <Button
              variant="link"
              className="mb-3 text-text-md font-normal text-gray-600 underline"
              to={{ pathName: "#" }}
            >
              Useful link 3
            </Button>
          </li>
        </ul>
      </div>
    </div>
    <div className="mt-6 text-center text-sm text-gray-500">
      Don't have an account?{" "}
      <Button variant="link" data-test-id="signupButton" to={"/join"}>
        Sign up
      </Button>
    </div>
  </>
);
