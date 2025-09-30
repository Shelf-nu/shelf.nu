import { useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { ChevronDownIcon } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";

import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import PasswordInput from "~/components/forms/password-input";
import { SelectWithOther } from "~/components/forms/select-with-other";
import { Button } from "~/components/shared/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import When from "~/components/when/when";
import { config } from "~/config/shelf.config";
import { sendEmail } from "~/emails/mail.server";
import { onboardingEmailText } from "~/emails/onboarding-email";
import {
  getAuthUserById,
  signInWithEmail,
} from "~/modules/auth/service.server";
import { upsertBusinessIntel } from "~/modules/business-intel/service.server";
import {
  ROLE_OPTIONS,
  TEAM_SIZE_OPTIONS,
  PRIMARY_USE_CASE_OPTIONS,
  CURRENT_SOLUTION_OPTIONS,
  TIMELINE_OPTIONS,
} from "~/modules/onboarding/constants";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getOrganizationById } from "~/modules/organization/service.server";
import { getUserByID, updateUser } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { SMTP_FROM } from "~/utils/env";
import { isZodValidationError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import {
  assertIsPost,
  data,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import { createStripeCustomer } from "~/utils/stripe.server";
import { tw } from "~/utils/tw";

const trimString = (value: unknown) =>
  typeof value === "string" ? value.trim() : value;

/**
 * Normalizes optional text fields so they return `undefined` instead of empty
 * strings after trimming, allowing Zod to treat whitespace-only answers as
 * missing data.
 */
const optionalTrimmedField = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

function requiredTrimmedField(message: string) {
  return z.preprocess(trimString, z.string().min(1, { message }));
}

function createOnboardingSchema({
  userSignedUpWithPassword,
  collectBusinessIntel,
  requireCompanyName,
}: {
  userSignedUpWithPassword: boolean;
  collectBusinessIntel: boolean;
  requireCompanyName: boolean;
}) {
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
      referralSource: collectBusinessIntel
        ? z.string().min(5, "Field is required.")
        : z.string().optional().nullable(),
      jobTitle: collectBusinessIntel
        ? requiredTrimmedField("Role is required")
        : optionalTrimmedField,
      teamSize: optionalTrimmedField,
      companyName: optionalTrimmedField,
      primaryUseCase: optionalTrimmedField,
      currentSolution: optionalTrimmedField,
      timeline: optionalTrimmedField,
    })
    .superRefine(
      (
        {
          password,
          confirmPassword,
          username,
          firstName,
          lastName,
          jobTitle,
          teamSize,
          companyName,
        },
        ctx
      ) => {
        if (password !== confirmPassword) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Password and confirm password must match",
            path: ["confirmPassword"],
          });
        }

        // Only validate teamSize and companyName if collectBusinessIntel is true
        // and jobTitle is not "Personal use"
        if (collectBusinessIntel && jobTitle !== "Personal use") {
          // teamSize is only required for non-invited users
          if (
            requireCompanyName &&
            (!teamSize || teamSize.trim().length === 0)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Team size is required",
              path: ["teamSize"],
            });
          }

          if (
            requireCompanyName &&
            (!companyName || companyName.trim().length === 0)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Company or organization is required",
              path: ["companyName"],
            });
          }
        }

        return { password, confirmPassword, username, firstName, lastName };
      }
    );
}

async function resolveInvitedCompanyName({
  verifiedOrganizationId,
  fallback,
}: {
  verifiedOrganizationId?: string | null;
  fallback?: string | null;
}) {
  if (!verifiedOrganizationId) {
    return fallback ?? undefined;
  }

  try {
    const organization = await getOrganizationById(verifiedOrganizationId);
    return organization.name ?? fallback ?? undefined;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `Failed to resolve organization name for ${verifiedOrganizationId}:`,
      error
    );
    return fallback ?? undefined;
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const searchParams = getCurrentSearchParams(request);
    const organizationIdParam = searchParams.get("organizationId") ?? undefined;
    const user = await getUserByID(userId, {
      userOrganizations: {
        select: {
          organizationId: true,
          organization: { select: { name: true } },
        },
      },
      businessIntel: true,
    });
    /** If the user is already onboarded, we assume they finished the process so we send them to the index */
    if (user.onboarded) {
      return redirect("/assets");
    }

    const authUser = await getAuthUserById(userId);

    const userSignedUpWithPassword =
      authUser.user_metadata.signup_method === "email-password";

    const organizationMembership = organizationIdParam
      ? user.userOrganizations?.find(
          (membership) => membership.organizationId === organizationIdParam
        )
      : null;

    /**
     * We only trust the organization context when the user already belongs to
     * that organization. Self-serve users often experiment with the query
     * string, so tying it to the membership list prevents accidental opt-outs
     * of the company field.
     */
    const createdWithInvite = Boolean(
      user.createdWithInvite || organizationMembership
    );

    const requireCompanyName = !createdWithInvite;

    const organizationName =
      organizationMembership?.organization?.name ??
      (user.createdWithInvite ? user.businessIntel?.companyName ?? null : null);

    const verifiedOrganizationId =
      organizationMembership?.organizationId ?? null;

    const OnboardingFormSchema = createOnboardingSchema({
      userSignedUpWithPassword,
      collectBusinessIntel: config.collectBusinessIntel,
      requireCompanyName,
    });

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
        collectBusinessIntel: config.collectBusinessIntel,
        createdWithInvite,
        requireCompanyName,
        organizationName,
        organizationId: verifiedOrganizationId,
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

    const existingUser = await getUserByID(userId, {
      userOrganizations: { select: { organizationId: true } },
    });

    const metadata = parseData(
      formData,
      z.object({
        userSignedUpWithPassword: z
          .string()
          .transform((value) => value === "true"),
        organizationId: z
          .string()
          .optional()
          .transform((value) => {
            if (!value) {
              return undefined;
            }

            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
          }),
      })
    );

    /**
     * Similar to the loader, we only honor the organization identifier when
     * the user is already linked to that workspace.
     */
    const organizationMembership = metadata.organizationId
      ? existingUser.userOrganizations?.find(
          (membership) => membership.organizationId === metadata.organizationId
        )
      : null;

    const verifiedOrganizationId =
      organizationMembership?.organizationId ?? null;
    const createdWithInvite = Boolean(
      existingUser.createdWithInvite || verifiedOrganizationId
    );

    const OnboardingFormSchema = createOnboardingSchema({
      userSignedUpWithPassword: metadata.userSignedUpWithPassword,
      collectBusinessIntel: config.collectBusinessIntel,
      requireCompanyName: !createdWithInvite,
    });

    const payload = parseData(formData, OnboardingFormSchema);

    const {
      jobTitle,
      teamSize,
      companyName,
      primaryUseCase,
      currentSolution,
      timeline,
      referralSource,
      password,
      confirmPassword,
      ...accountFields
    } = payload;

    // Separate user account fields from business intel fields
    const userUpdatePayload: typeof accountFields & {
      id: string;
      onboarded: true;
      password?: typeof password;
      confirmPassword?: typeof confirmPassword;
    } = {
      ...accountFields,
      id: userId,
      onboarded: true,
    };

    if (!metadata.userSignedUpWithPassword) {
      userUpdatePayload.password = password;
      userUpdatePayload.confirmPassword = confirmPassword;
    }

    /** Update the user */
    const user = await updateUser(userUpdatePayload);

    /** Save business intelligence data separately */
    if (config.collectBusinessIntel) {
      await upsertBusinessIntel({
        userId,
        howDidYouHearAboutUs: referralSource,
        jobTitle,
        teamSize,
        companyName: await resolveInvitedCompanyName({
          verifiedOrganizationId,
          fallback: companyName ?? null,
        }),
        primaryUseCase,
        currentSolution,
        timeline,
      });
    }

    /**
     * When setting password as part of onboarding, the session gets destroyed as part of the normal password reset flow.
     * In this case, we need to create a new session for the user.
     * We only need to do that if the user didn't sign up using password. In that case the password gets set in the updateUser above
     */
    if (user && !metadata.userSignedUpWithPassword) {
      //making sure new session is created.
      const authSession = await signInWithEmail(user.email, password as string);
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

    const redirectViaInvite = Boolean(
      verifiedOrganizationId || user.createdWithInvite
    );

    const headers = [];

    if (verifiedOrganizationId) {
      headers.push(
        setCookie(await setSelectedOrganizationIdCookie(verifiedOrganizationId))
      );
    }

    return redirect(redirectViaInvite ? `/assets` : `/welcome`, {
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
  const {
    user,
    userSignedUpWithPassword,
    title,
    subHeading,
    collectBusinessIntel,
    organizationName,
    requireCompanyName,
    organizationId,
  } = useLoaderData<typeof loader>();

  const OnboardingFormSchema = createOnboardingSchema({
    userSignedUpWithPassword,
    collectBusinessIntel,
    requireCompanyName,
  });

  const zo = useZorm("NewQuestionWizardScreen", OnboardingFormSchema);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  // Business intel data from new table, fallback to legacy fields for historical data
  const businessIntel = user?.businessIntel;
  const jobTitleDefault = businessIntel?.jobTitle ?? null;
  const teamSizeDefault = businessIntel?.teamSize ?? null;
  const companyNameDefault = requireCompanyName
    ? businessIntel?.companyName ?? ""
    : organizationName ?? businessIntel?.companyName ?? "";
  const referralSourceDefault =
    businessIntel?.howDidYouHearAboutUs ?? user?.referralSource ?? "";

  const [isPersonalUse, setIsPersonalUse] = useState(
    jobTitleDefault === "Personal use"
  );

  const [customizeOpen, setCustomizeOpen] = useState(
    Boolean(
      businessIntel?.primaryUseCase ||
        businessIntel?.currentSolution ||
        businessIntel?.timeline
    )
  );

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
        {organizationId ? (
          <input type="hidden" name="organizationId" value={organizationId} />
        ) : null}

        <div className="md:flex md:gap-6">
          <Input
            label="First name"
            required
            data-test-id="firstName"
            type="text"
            placeholder="Zaans"
            name={zo.fields.firstName()}
            error={zo.errors.firstName()?.message}
            className="mb-5 md:mb-0"
          />
          <Input
            label="Last name"
            required
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
            required
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
              required
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
              required
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

        <When truthy={collectBusinessIntel}>
          <>
            <Input
              required
              label="How did you hear about us?"
              placeholder="Twitter, Reddit, ChatGPT, Google, etc..."
              name={zo.fields.referralSource()}
              defaultValue={referralSourceDefault}
              error={zo.errors.referralSource()?.message}
            />

            <SelectWithOther
              label="What's your role?"
              name={zo.fields.jobTitle()}
              options={ROLE_OPTIONS}
              required
              error={zo.errors.jobTitle()?.message}
              defaultValue={jobTitleDefault}
              otherInputLabel="Specify your role"
              otherInputPlaceholder="Tell us about your role"
              onValueChange={(value) => {
                setIsPersonalUse(value === "Personal use");
              }}
            />

            <When truthy={!isPersonalUse && requireCompanyName}>
              <SelectWithOther
                label="How many people will use this?"
                name={zo.fields.teamSize()}
                options={TEAM_SIZE_OPTIONS}
                required
                error={zo.errors.teamSize()?.message}
                defaultValue={teamSizeDefault}
                otherInputLabel="Specify team size"
                otherInputPlaceholder="Enter your team size"
              />
            </When>

            <When truthy={!isPersonalUse && requireCompanyName}>
              <Input
                label="Company/Organization"
                placeholder="Shelf Inc."
                name={zo.fields.companyName()}
                error={zo.errors.companyName()?.message}
                defaultValue={companyNameDefault}
                required
              />
            </When>

            <When truthy={isPersonalUse || !requireCompanyName}>
              <input
                type="hidden"
                name={zo.fields.companyName()}
                value={companyNameDefault}
              />
            </When>
          </>
        </When>

        <When truthy={collectBusinessIntel}>
          <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-left font-medium text-gray-700 hover:bg-gray-100"
              >
                <span>
                  Help us customize Shelf
                  <span className="ml-1 text-sm font-normal text-gray-500">
                    (optional)
                  </span>
                </span>
                <ChevronDownIcon
                  className={tw(
                    "size-4 transition-transform duration-200",
                    customizeOpen ? "rotate-180" : ""
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <SelectWithOther
                  label="What will you primarily track?"
                  name={zo.fields.primaryUseCase()}
                  options={PRIMARY_USE_CASE_OPTIONS}
                  defaultValue={businessIntel?.primaryUseCase ?? null}
                  otherInputLabel="Tell us what you'll track"
                  otherInputPlaceholder="Describe your use case"
                  placeholder="Select an option"
                />
                <SelectWithOther
                  label="How do you currently track assets?"
                  name={zo.fields.currentSolution()}
                  options={CURRENT_SOLUTION_OPTIONS}
                  defaultValue={businessIntel?.currentSolution ?? null}
                  otherInputLabel="Share your current solution"
                  otherInputPlaceholder="Let us know what you use today"
                  placeholder="Select an option"
                />
                <div className="md:col-span-2">
                  <SelectWithOther
                    label="When do you need this working?"
                    name={zo.fields.timeline()}
                    options={TIMELINE_OPTIONS}
                    defaultValue={businessIntel?.timeline ?? null}
                    otherInputLabel="Specify your timeline"
                    otherInputPlaceholder="Tell us about your timeline"
                    placeholder="Select an option"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </When>

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
