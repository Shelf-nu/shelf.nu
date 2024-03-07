import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import PasswordInput from "~/components/forms/password-input";
import { Button } from "~/components/shared";
import { config } from "~/config/shelf.config";
import { onboardingEmailText } from "~/emails/onboarding-email";
import { getAuthUserByAccessToken } from "~/modules/auth/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID, updateUser } from "~/modules/user";
import type { UpdateUserPayload } from "~/modules/user/types";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { sendEmail } from "~/utils/mail.server";
import { createStripeCustomer } from "~/utils/stripe.server";

function createOnboardingSchema(userSignedUpWithPassword: boolean) {
  return z
    .object({
      username: z
        .string()
        .min(4, { message: "Must be at least 4 characters long" }),
      firstName: z.string().min(1, { message: "First name is required" }),
      lastName: z.string().min(1, { message: "Last name is required" }),
      password: userSignedUpWithPassword
        ? z.string().optional()
        : z.string().min(8, "Password is too short. Minimum 8 characters."),
      confirmPassword: userSignedUpWithPassword
        ? z.string().optional()
        : z.string().min(8, "Password is too short. Minimum 8 characters."),
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
}

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = await context.getSession();
  const user = await getUserByID(authSession?.userId);

  /** If the user is already onboarded, we assume they finished the process so we send them to the index */
  if (user?.onboarded) {
    return redirect("/");
  }

  const authUser = await getAuthUserByAccessToken(authSession.accessToken);

  const userSignedUpWithPassword =
    authUser?.user_metadata?.signup_method === "email-password";
  const OnboardingFormSchema = createOnboardingSchema(userSignedUpWithPassword);

  // If not auth session redirect to login
  const title = "Set up your account";
  const subHeading =
    "You are almost ready to use Shelf. We just need some basic information to get you started.";
  return json({
    title,
    subHeading,
    user,
    userSignedUpWithPassword,
    OnboardingFormSchema,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);

  const authSession = await context.getSession();
  const formData = await request.formData();

  const userSignedUpWithPassword =
    formData.get("userSignedUpWithPassword") === "true";
  const OnboardingFormSchema = createOnboardingSchema(userSignedUpWithPassword);

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
  const { user, errors } = await updateUser(updateUserPayload);

  if (!user && errors) {
    return json({ errors }, { status: 400 });
  }

  if (user) {
    /** We create the stripe customer when the user gets onboarded.
     * This is to make sure that we have a stripe customer for the user.
     * We have to do it at this point, as its the first time we have the user's first and last name
     */
    if (!user.customerId) {
      await createStripeCustomer({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        userId: user.id,
      });
    }

    if (config.sendOnboardingEmail) {
      /** Send onboarding email */
      await sendEmail({
        from: `"Carlos from shelf.nu" <carlos@shelf.nu>`,
        to: user.email,
        subject: "🏷️ Welcome to Shelf.nu",
        text: onboardingEmailText({ firstName: user.firstName as string }),
      });
    }
  }

  const organizationIdFromForm =
    (formData.get("organizationId") as string) || null;

  const headers = [];

  if (organizationIdFromForm) {
    headers.push(
      setCookie(await setSelectedOrganizationIdCookie(organizationIdFromForm))
    );
  }

  return redirect(
    `/welcome${
      organizationIdFromForm ? `?organizationId=${organizationIdFromForm}` : ""
    }`,
    {
      headers,
    }
  );
}

export default function Onboarding() {
  const { user, userSignedUpWithPassword, title, subHeading } =
    useLoaderData<typeof loader>();

  const [searchParams] = useSearchParams();
  const OnboardingFormSchema = createOnboardingSchema(userSignedUpWithPassword);

  const zo = useZorm("NewQuestionWizardScreen", OnboardingFormSchema);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <div className="p-6 sm:p-8">
      <h2 className="mb-1">{title}</h2>
      <p>{subHeading}</p>
      <Form className="mt-6 flex flex-col gap-5" method="post" ref={zo.ref}>
        <input
          type="hidden"
          name="userSignedUpWithPassword"
          value={String(userSignedUpWithPassword)}
        />
        <input
          type="hidden"
          name="organizationId"
          value={searchParams.get("organizationId") || ""}
        />

        <div className="md:flex md:gap-6">
          <Input
            label="First name"
            data-test-id="firstName"
            type="text"
            placeholder="Zaans"
            name={zo.fields.firstName()}
            error={zo.errors.firstName()?.message}
            className="mb-5 md:mb-0"
          />
          <Input
            label="Last name"
            data-test-id="lastName"
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
            error={
              // @ts-ignore
              actionData?.errors?.username || zo.errors.username()?.message
            }
            defaultValue={user?.username}
            className="w-full"
            inputClassName="flex-1"
          />
        </div>
        {!userSignedUpWithPassword && (
          <>
            <PasswordInput
              label="Password"
              placeholder="********"
              data-test-id="password"
              name={zo.fields.password()}
              type="password"
              autoComplete="new-password"
              inputClassName="w-full"
              error={zo.errors.password()?.message}
            />

            <PasswordInput
              label="Confirm password"
              data-test-id="confirmPassword"
              placeholder="********"
              name={zo.fields.confirmPassword()}
              type="password"
              autoComplete="new-password"
              error={zo.errors.confirmPassword()?.message}
            />
          </>
        )}
        <div>
          <Button
            data-test-id="onboard"
            type="submit"
            width="full"
            disabled={disabled}
          >
            Submit
          </Button>
        </div>
      </Form>
    </div>
  );
}
