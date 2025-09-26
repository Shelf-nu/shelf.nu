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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
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
import { isOption } from "~/utils/options";
import { createStripeCustomer } from "~/utils/stripe.server";
import { tw } from "~/utils/tw";

const ROLE_OPTIONS = [
  "Operations Manager",
  "IT Administrator",
  "Facilities Manager",
  "Equipment Manager",
  "Office Manager",
  "Business Owner",
  "Project Manager",
  "Personal use", // Allows individual signups to provide a meaningful answer
] as const;

const TEAM_SIZE_OPTIONS = [
  "Just me (1)",
  "Small team (2-10)",
  "Department (11-50)",
  "Large organization (50+)",
] as const;

const PRIMARY_USE_CASE_OPTIONS = [
  "IT hardware",
  "Office equipment",
  "Facilities assets",
  "Tools & machinery",
  "Inventory & supplies",
] as const;

const CURRENT_SOLUTION_OPTIONS = [
  "Spreadsheets",
  "Paper logs",
  "Dedicated asset tool",
  "Not tracking yet",
] as const;

const TIMELINE_OPTIONS = [
  "This week",
  "Within a month",
  "Next quarter",
  "Just exploring",
] as const;

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
  showHowDidYouFindUs,
  requireCompanyName,
}: {
  userSignedUpWithPassword: boolean;
  showHowDidYouFindUs: boolean;
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
      referralSource: showHowDidYouFindUs
        ? z.string().min(5, "Field is required.")
        : z.string().optional().nullable(),
      jobTitle: requiredTrimmedField("Role is required"),
      teamSize: requiredTrimmedField("Team size is required"),
      companyName: requireCompanyName
        ? requiredTrimmedField("Company or organization is required")
        : optionalTrimmedField,
      primaryUseCase: optionalTrimmedField,
      currentSolution: optionalTrimmedField,
      timeline: optionalTrimmedField,
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
  } catch {
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
      (user.createdWithInvite ? user.companyName ?? null : null);

    const verifiedOrganizationId =
      organizationMembership?.organizationId ?? null;

    const OnboardingFormSchema = createOnboardingSchema({
      userSignedUpWithPassword,
      showHowDidYouFindUs: config.showHowDidYouFindUs,
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
        showHowDidYouFindUs: config.showHowDidYouFindUs,
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
      showHowDidYouFindUs: config.showHowDidYouFindUs,
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

    const userUpdatePayload: typeof accountFields & {
      id: string;
      onboarded: true;
      referralSource: typeof referralSource;
      jobTitle: typeof jobTitle;
      teamSize: typeof teamSize;
      companyName: string | undefined;
      primaryUseCase: typeof primaryUseCase;
      currentSolution: typeof currentSolution;
      timeline: typeof timeline;
      password?: typeof password;
      confirmPassword?: typeof confirmPassword;
    } = {
      ...accountFields,
      id: userId,
      onboarded: true,
      referralSource,
      jobTitle,
      teamSize,
      companyName: await resolveInvitedCompanyName({
        verifiedOrganizationId,
        fallback: companyName ?? existingUser.companyName ?? null,
      }),
      primaryUseCase,
      currentSolution,
      timeline,
    };

    if (!metadata.userSignedUpWithPassword) {
      userUpdatePayload.password = password;
      userUpdatePayload.confirmPassword = confirmPassword;
    }

    /** Update the user */
    const user = await updateUser(userUpdatePayload);

    /**
     * When setting password as part of onboarding, the session gets destroyed as part of the normal password reset flow.
     * In this case, we need to create a new session for the user.
     * We only need to do that if the user DIDNT sign up using password. In that case the password gets set in the updateUser above
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
    showHowDidYouFindUs,
    organizationName,
    requireCompanyName,
    organizationId,
  } = useLoaderData<typeof loader>();

  const OnboardingFormSchema = createOnboardingSchema({
    userSignedUpWithPassword,
    showHowDidYouFindUs,
    requireCompanyName,
  });

  const zo = useZorm("NewQuestionWizardScreen", OnboardingFormSchema);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const companyNameDefault = requireCompanyName
    ? user?.companyName ?? ""
    : organizationName ?? user?.companyName ?? "";

  const initialTeamSize = isOption(
    TEAM_SIZE_OPTIONS,
    user?.teamSize ?? undefined
  )
    ? (user?.teamSize as (typeof TEAM_SIZE_OPTIONS)[number])
    : "";
  const [teamSizeSelection, setTeamSizeSelection] = useState(initialTeamSize);

  const initialTimeline = isOption(
    TIMELINE_OPTIONS,
    user?.timeline ?? undefined
  )
    ? (user?.timeline as (typeof TIMELINE_OPTIONS)[number])
    : "";
  const [timelineSelection, setTimelineSelection] = useState(initialTimeline);

  const [customizeOpen, setCustomizeOpen] = useState(
    Boolean(user?.primaryUseCase || user?.currentSolution || user?.timeline)
  );

  const jobTitleError = zo.errors.jobTitle()?.message;
  const teamSizeError = zo.errors.teamSize()?.message;

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

        <When truthy={showHowDidYouFindUs}>
          <Input
            required
            label="How did you hear about us?"
            placeholder="Twitter, Reddit, ChatGPT, Google, etc..."
            name={zo.fields.referralSource()}
            error={zo.errors.referralSource()?.message}
          />
        </When>

        <div className="grid gap-5 md:grid-cols-2">
          <SelectWithOther
            label="What's your role?"
            name={zo.fields.jobTitle()}
            options={ROLE_OPTIONS}
            required
            error={jobTitleError}
            defaultValue={user?.jobTitle ?? null}
            otherInputLabel="Specify your role"
            otherInputPlaceholder="Tell us about your role"
          />
          <div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-700">
                How many people will use this?
                <span className="text-error-500"> *</span>
              </span>
              <Select
                value={teamSizeSelection || undefined}
                onValueChange={(value) => setTeamSizeSelection(value)}
              >
                <SelectTrigger
                  aria-label="Select team size"
                  className={tw(
                    "px-3 py-2 text-left text-gray-900 data-[placeholder]:text-gray-500",
                    teamSizeError &&
                      "border-error-300 focus:border-error-300 focus:ring-error-100"
                  )}
                >
                  <SelectValue placeholder="Select team size" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="w-full min-w-[260px]"
                  align="start"
                >
                  <div className="max-h-60 overflow-auto">
                    {TEAM_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </div>
                </SelectContent>
              </Select>
            </label>
            <input
              type="hidden"
              name={zo.fields.teamSize()}
              value={teamSizeSelection}
            />
            <When truthy={Boolean(teamSizeError)}>
              <p className="mt-1 text-sm text-error-500">{teamSizeError}</p>
            </When>
          </div>
        </div>

        {requireCompanyName ? (
          <Input
            label="Company/Organization"
            placeholder="Shelf Inc."
            name={zo.fields.companyName()}
            error={zo.errors.companyName()?.message}
            defaultValue={companyNameDefault}
            required
          />
        ) : (
          <input
            type="hidden"
            name={zo.fields.companyName()}
            value={companyNameDefault}
          />
        )}

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
                defaultValue={user?.primaryUseCase ?? null}
                otherInputLabel="Tell us what you'll track"
                otherInputPlaceholder="Describe your use case"
                placeholder="Select an option"
              />
              <SelectWithOther
                label="How do you currently track assets?"
                name={zo.fields.currentSolution()}
                options={CURRENT_SOLUTION_OPTIONS}
                defaultValue={user?.currentSolution ?? null}
                otherInputLabel="Share your current solution"
                otherInputPlaceholder="Let us know what you use today"
                placeholder="Select an option"
              />
              <div className="md:col-span-2">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    When do you need this working?
                  </span>
                  <Select
                    value={timelineSelection || undefined}
                    onValueChange={(value) => setTimelineSelection(value)}
                  >
                    <SelectTrigger
                      aria-label="Select timeline"
                      className="px-3 py-2 text-left text-gray-900 data-[placeholder]:text-gray-500"
                    >
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      className="w-full min-w-[260px]"
                      align="start"
                    >
                      <div className="max-h-60 overflow-auto">
                        {TIMELINE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </div>
                    </SelectContent>
                  </Select>
                </label>
                <input
                  type="hidden"
                  name={zo.fields.timeline()}
                  value={timelineSelection}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

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
