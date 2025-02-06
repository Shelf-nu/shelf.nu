import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import PasswordInput from "~/components/forms/password-input";
import { Button } from "~/components/shared/button";
import { config } from "~/config/shelf.config";
import { sendEmail } from "~/emails/mail.server";
import { onboardingEmailText } from "~/emails/onboarding-email";
import { useSearchParams } from "~/hooks/search-params";
import {
  getAuthUserById,
  signInWithEmail,
} from "~/modules/auth/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID, updateUser } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { SMTP_FROM } from "~/utils/env";
import { isZodValidationError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
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
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const user = await getUserByID(userId);
    /** If the user is already onboarded, we assume they finished the process so we send them to the index */
    if (user.onboarded) {
      return redirect("/assets");
    }

    const authUser = await getAuthUserById(userId);

    const userSignedUpWithPassword =
      authUser.user_metadata.signup_method === "email-password";

    const OnboardingFormSchema = createOnboardingSchema(
      userSignedUpWithPassword
    );

    const title = "Set up your account";
    const subHeading =
      "You are almost ready to use Shelf. We just need some basic information to get you started.";

    return json(
      data({
        title,
        subHeading,
        user,
        userSignedUpWithPassword,
        OnboardingFormSchema,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();

    const { userSignedUpWithPassword } = parseData(
      formData,
      z.object({
        userSignedUpWithPassword: z.string().transform((val) => val === "true"),
      })
    );

    const OnboardingFormSchema = createOnboardingSchema(
      userSignedUpWithPassword
    );

    const payload = parseData(formData, OnboardingFormSchema);

    /** If the user already signed up with password, we dont need to update it in their account, so we remove it from the payload  */
    if (userSignedUpWithPassword) {
      delete payload.password;
      delete payload.confirmPassword;
    }

    /** Update the user */
    const user = await updateUser({
      ...payload,
      id: userId,
      onboarded: true,
    });

    /**
     * When setting password as part of onboarding, the session gets destroyed as part of the normal password reset flow.
     * In this case, we need to create a new session for the user.
     * We only need to do that if the user DIDNT sign up using password. In that case the password gets set in the updateUser above
     */
    if (user && !userSignedUpWithPassword) {
      //making sure new session is created.
      const authSession = await signInWithEmail(
        user.email,
        payload.password as string
      );
      if (authSession) {
        context.setSession(authSession);
      }
    }

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
      sendEmail({
        from: SMTP_FROM || `"Carlos from shelf.nu" <carlos@emails.shelf.nu>`,
        replyTo: "carlos@shelf.nu",
        to: user.email,
        subject: "🏷️ Welcome to Shelf - can I ask you a question?",
        text: onboardingEmailText({ firstName: user.firstName as string }),
      });
    }

    /** If organizationId is passed, that means the user comes from an invite */
    const { organizationId } = parseData(
      formData,
      z.object({ organizationId: z.string().optional() })
    );

    const createdWithInvite = !!organizationId || user.createdWithInvite;

    const headers = [];

    if (organizationId) {
      headers.push(
        setCookie(await setSelectedOrganizationIdCookie(organizationId))
      );
    }

    return redirect(createdWithInvite ? `/assets` : `/welcome`, {
      headers,
    });
  } catch (cause) {
    const reason = makeShelfError(
      cause,
      { userId },
      !isZodValidationError(cause)
    );
    return json(error(reason), { status: reason.status });
  }
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
              getValidationErrors<typeof OnboardingFormSchema>(
                actionData?.error
              )?.username?.message || zo.errors.username()?.message
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
