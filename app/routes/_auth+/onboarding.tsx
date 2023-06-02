import type { ActionArgs, V2_MetaFunction } from "@remix-run/node";
import { redirect, type LoaderArgs, json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { getUserByID, updateUser } from "~/modules/user";
import type { UpdateUserPayload } from "~/modules/user/types";
import { assertIsPost } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

const OnboardingFormSchema = z
  .object({
    username: z
      .string()
      .min(4, { message: "Must be at least 4 characters long" }),
    firstName: z.string().min(1, { message: "First name is required" }),
    lastName: z.string().min(1, { message: "Last name is required" }),
    password: z.string().min(8, "Password is too short. Minimum 8 characters."),
    confirmPassword: z
      .string()
      .min(8, "Password is too short. Minimum 8 characters."),
  })
  .superRefine(
    ({ password, confirmPassword, username, firstName, lastName }, ctx) => {
      if (password !== confirmPassword) {
        return ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password and confirm password must match",
          path: ["confirmPassword"],
        });
      }

      return { password, confirmPassword, username, firstName, lastName };
    }
  );

export async function loader({ request }: LoaderArgs) {
  // const authSession = await getAuthSession(request);
  const authSession = await requireAuthSession(request);

  const user = await getUserByID(authSession?.userId);

  // If not auth session redirect to login
  const title = "Set up your account";
  const subHeading =
    "You are almost ready to use Shelf. We just need some basic information to get you started.";
  return json({ title, subHeading, user });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export async function action({ request }: ActionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);
  const formData = await request.formData();
  const result = await OnboardingFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      { status: 400 }
    );
  }

  /** Create the payload if the client side validation works */
  const updateUserPayload: UpdateUserPayload = {
    ...result?.data,
    id: authSession.userId,
    onboarded: true,
  };

  /** Update the user */
  const updatedUser = await updateUser(updateUserPayload);

  if (updatedUser.errors) {
    return json({ errors: updatedUser.errors }, { status: 400 });
  }

  return redirect("/", {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function Onboarding() {
  const zo = useZorm("NewQuestionWizardScreen", OnboardingFormSchema);
  const { user } = useLoaderData();

  return (
    <div>
      <Form className="flex flex-col gap-5" method="post" ref={zo.ref}>
        <div className="flex gap-6">
          <Input
            label="First name"
            type="text"
            placeholder="Zaans"
            name={zo.fields.firstName()}
            error={zo.errors.firstName()?.message}
          />
          <Input
            label="Last name"
            type="text"
            placeholder="Huisje"
            name={zo.fields.lastName()}
            error={zo.errors.lastName()?.message}
          />
        </div>
        <div>
          <Input
            label="Username"
            addOn="shelf.nu/"
            type="text"
            name={zo.fields.username()}
            error={zo.errors.username()?.message}
            defaultValue={user?.username}
            className="w-full"
            inputClassName="flex-1"
          />
        </div>
        <div>
          <Input
            label="Password"
            placeholder="********"
            data-test-id="password"
            name={zo.fields.password()}
            type="password"
            autoComplete="new-password"
            inputClassName="w-full"
            error={zo.errors.password()?.message}
          />
        </div>
        <div>
          <Input
            label="Confirm password"
            data-test-id="confirmPassword"
            placeholder="********"
            name={zo.fields.confirmPassword()}
            type="password"
            autoComplete="new-password"
            error={zo.errors.confirmPassword()?.message}
          />
        </div>
        <div>
          <Button data-test-id="onboard" type="submit" width="full">
            Submit
          </Button>
        </div>
      </Form>
    </div>
  );
}
