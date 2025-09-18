import { useState } from "react";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
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
import { useSearchParams } from "~/hooks/search-params";
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
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import { createStripeCustomer } from "~/utils/stripe.server";
import { tw } from "~/utils/tw";

const OTHER_OPTION_VALUE = "other";

const ROLE_OPTIONS = [
  "Operations Manager",
  "IT Administrator",
  "Facilities Manager",
  "Equipment Manager",
  "Office Manager",
  "Business Owner",
  "Project Manager",
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
      jobTitle: z.string().min(1, { message: "Role is required" }),
      teamSize: z.string().min(1, { message: "Team size is required" }),
      companyName: requireCompanyName
        ? z.string().min(1, { message: "Company or organization is required" })
        : z.string().optional().nullable(),
      primaryUseCase: z.string().optional().nullable(),
      currentSolution: z.string().optional().nullable(),
      timeline: z.string().optional().nullable(),
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

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const url = new URL(request.url);
    const organizationIdParam = url.searchParams.get("organizationId");
    const user = await getUserByID(userId);
    /** If the user is already onboarded, we assume they finished the process so we send them to the index */
    if (user.onboarded) {
      return redirect("/assets");
    }

    const authUser = await getAuthUserById(userId);

    const userSignedUpWithPassword =
      authUser.user_metadata.signup_method === "email-password";

    let organizationName: string | null = null;

    if (organizationIdParam) {
      try {
        const organization = await getOrganizationById(organizationIdParam);
        organizationName = organization.name;
      } catch {
        organizationName = null;
      }
    }

    const createdWithInvite =
      user.createdWithInvite || Boolean(organizationIdParam);

    const OnboardingFormSchema = createOnboardingSchema({
      userSignedUpWithPassword,
      showHowDidYouFindUs: config.showHowDidYouFindUs,
      requireCompanyName: !createdWithInvite,
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
        organizationName,
        organizationId: organizationIdParam,
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

    const organizationIdValue = formData.get("organizationId");
    const organizationId =
      typeof organizationIdValue === "string" && organizationIdValue.length
        ? organizationIdValue
        : undefined;

    const existingUser = await getUserByID(userId);

    const { userSignedUpWithPassword } = parseData(
      formData,
      z.object({
        userSignedUpWithPassword: z.string().transform((val) => val === "true"),
      })
    );

    const isInvited = existingUser.createdWithInvite || Boolean(organizationId);

    const OnboardingFormSchema = createOnboardingSchema({
      userSignedUpWithPassword,
      showHowDidYouFindUs: config.showHowDidYouFindUs,
      requireCompanyName: !isInvited,
    });

    const payload = parseData(formData, OnboardingFormSchema);

    const {
      jobTitle,
      teamSize,
      companyName: rawCompanyName,
      primaryUseCase,
      currentSolution,
      timeline,
      referralSource,
      ...rest
    } = payload;

    const basePayload = { ...rest } as typeof rest & {
      password?: string;
      confirmPassword?: string;
    };

    /** If the user already signed up with password, we dont need to update it in their account, so we remove it from the payload  */
    if (userSignedUpWithPassword) {
      delete basePayload.password;
      delete basePayload.confirmPassword;
    }

    const sanitizeOptional = (value?: string | null) => {
      if (!value) {
        return undefined;
      }

      const trimmed = value.trim();

      return trimmed.length > 0 ? trimmed : undefined;
    };

    let resolvedCompanyName = rawCompanyName ?? undefined;

    if (isInvited) {
      const trimmedCompanyName = resolvedCompanyName?.trim() ?? "";

      if (!trimmedCompanyName) {
        if (organizationId) {
          try {
            const organization = await getOrganizationById(organizationId);
            resolvedCompanyName = organization.name ?? undefined;
          } catch {
            resolvedCompanyName = existingUser.companyName ?? undefined;
          }
        } else if (existingUser.companyName) {
          resolvedCompanyName = existingUser.companyName ?? undefined;
        }
      }
    }

    /** Update the user */
    const user = await updateUser({
      ...basePayload,
      id: userId,
      onboarded: true,
      referralSource: sanitizeOptional(referralSource),
      jobTitle: jobTitle.trim(),
      teamSize: teamSize.trim(),
      companyName: sanitizeOptional(resolvedCompanyName),
      primaryUseCase: sanitizeOptional(primaryUseCase),
      currentSolution: sanitizeOptional(currentSolution),
      timeline: sanitizeOptional(timeline),
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
  const {
    user,
    userSignedUpWithPassword,
    title,
    subHeading,
    showHowDidYouFindUs,
    createdWithInvite,
    organizationName,
  } = useLoaderData<typeof loader>();

  const [searchParams] = useSearchParams();
  const requireCompanyName = !createdWithInvite;
  const OnboardingFormSchema = createOnboardingSchema({
    userSignedUpWithPassword,
    showHowDidYouFindUs,
    requireCompanyName,
  });

  const zo = useZorm("NewQuestionWizardScreen", OnboardingFormSchema);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const coerce = (value?: string | null) => value ?? "";

  const companyNameDefault = requireCompanyName
    ? coerce(user?.companyName)
    : coerce(organizationName ?? user?.companyName);

  const initialJobTitle = coerce(user?.jobTitle);
  const hasPresetRole = ROLE_OPTIONS.includes(
    initialJobTitle as (typeof ROLE_OPTIONS)[number]
  );
  const initialJobTitleSelection = hasPresetRole
    ? initialJobTitle
    : initialJobTitle
    ? OTHER_OPTION_VALUE
    : "";
  const initialJobTitleOther =
    initialJobTitleSelection === OTHER_OPTION_VALUE ? initialJobTitle : "";

  const [jobTitleSelection, setJobTitleSelection] = useState(
    initialJobTitleSelection
  );
  const [jobTitleOtherValue, setJobTitleOtherValue] =
    useState(initialJobTitleOther);
  const jobTitleValue =
    jobTitleSelection === OTHER_OPTION_VALUE
      ? jobTitleOtherValue
      : jobTitleSelection;

  const initialTeamSize = coerce(user?.teamSize);
  const teamSizePreset = TEAM_SIZE_OPTIONS.includes(
    initialTeamSize as (typeof TEAM_SIZE_OPTIONS)[number]
  );
  const [teamSizeSelection, setTeamSizeSelection] = useState(
    teamSizePreset ? initialTeamSize : ""
  );

  const initialPrimaryUseCase = coerce(user?.primaryUseCase);
  const hasPrimaryUseCasePreset = PRIMARY_USE_CASE_OPTIONS.includes(
    initialPrimaryUseCase as (typeof PRIMARY_USE_CASE_OPTIONS)[number]
  );
  const initialPrimaryUseCaseSelection = hasPrimaryUseCasePreset
    ? initialPrimaryUseCase
    : initialPrimaryUseCase
    ? OTHER_OPTION_VALUE
    : "";
  const initialPrimaryUseCaseOther =
    initialPrimaryUseCaseSelection === OTHER_OPTION_VALUE
      ? initialPrimaryUseCase
      : "";

  const [primaryUseCaseSelection, setPrimaryUseCaseSelection] = useState(
    initialPrimaryUseCaseSelection
  );
  const [primaryUseCaseOtherValue, setPrimaryUseCaseOtherValue] = useState(
    initialPrimaryUseCaseOther
  );
  const primaryUseCaseValue =
    primaryUseCaseSelection === OTHER_OPTION_VALUE
      ? primaryUseCaseOtherValue
      : primaryUseCaseSelection;

  const initialCurrentSolution = coerce(user?.currentSolution);
  const hasCurrentSolutionPreset = CURRENT_SOLUTION_OPTIONS.includes(
    initialCurrentSolution as (typeof CURRENT_SOLUTION_OPTIONS)[number]
  );
  const initialCurrentSolutionSelection = hasCurrentSolutionPreset
    ? initialCurrentSolution
    : initialCurrentSolution
    ? OTHER_OPTION_VALUE
    : "";
  const initialCurrentSolutionOther =
    initialCurrentSolutionSelection === OTHER_OPTION_VALUE
      ? initialCurrentSolution
      : "";

  const [currentSolutionSelection, setCurrentSolutionSelection] = useState(
    initialCurrentSolutionSelection
  );
  const [currentSolutionOtherValue, setCurrentSolutionOtherValue] = useState(
    initialCurrentSolutionOther
  );
  const currentSolutionValue =
    currentSolutionSelection === OTHER_OPTION_VALUE
      ? currentSolutionOtherValue
      : currentSolutionSelection;

  const initialTimeline = coerce(user?.timeline);
  const timelinePreset = TIMELINE_OPTIONS.includes(
    initialTimeline as (typeof TIMELINE_OPTIONS)[number]
  );
  const [timelineSelection, setTimelineSelection] = useState(
    timelinePreset ? initialTimeline : ""
  );

  const [customizeOpen, setCustomizeOpen] = useState(false);

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
        <input
          type="hidden"
          name="organizationId"
          value={searchParams.get("organizationId") || ""}
        />

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
          <div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-700">
                What's your role?
                <span className="text-error-500"> *</span>
              </span>
              <Select
                value={jobTitleSelection || undefined}
                onValueChange={(value) => {
                  setJobTitleSelection(value);
                  if (value !== OTHER_OPTION_VALUE) {
                    setJobTitleOtherValue("");
                  }
                }}
              >
                <SelectTrigger
                  aria-label="Select your role"
                  className={tw(
                    "px-3 py-2 text-left text-gray-900 data-[placeholder]:text-gray-500",
                    jobTitleError &&
                      "border-error-300 focus:border-error-300 focus:ring-error-100"
                  )}
                >
                  <SelectValue placeholder="Select your role" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="w-full min-w-[260px]"
                  align="start"
                >
                  <div className="max-h-60 overflow-auto">
                    {ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER_OPTION_VALUE}>Other</SelectItem>
                  </div>
                </SelectContent>
              </Select>
            </label>
            <input
              type="hidden"
              name={zo.fields.jobTitle()}
              value={jobTitleValue}
            />
            <When truthy={jobTitleSelection === OTHER_OPTION_VALUE}>
              <div className="mt-2">
                <Input
                  label="Specify your role"
                  hideLabel
                  placeholder="Tell us about your role"
                  value={jobTitleOtherValue}
                  onChange={(event) =>
                    setJobTitleOtherValue(event.target.value)
                  }
                  error={jobTitleError}
                  hideErrorText
                />
              </div>
            </When>
            <When truthy={Boolean(jobTitleError)}>
              <p className="mt-1 text-sm text-error-500">{jobTitleError}</p>
            </When>
          </div>
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
              <div>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    What will you primarily track?
                  </span>
                  <Select
                    value={primaryUseCaseSelection || undefined}
                    onValueChange={(value) => {
                      setPrimaryUseCaseSelection(value);
                      if (value !== OTHER_OPTION_VALUE) {
                        setPrimaryUseCaseOtherValue("");
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label="Select primary use case"
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
                        {PRIMARY_USE_CASE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                        <SelectItem value={OTHER_OPTION_VALUE}>
                          Other
                        </SelectItem>
                      </div>
                    </SelectContent>
                  </Select>
                </label>
                <input
                  type="hidden"
                  name={zo.fields.primaryUseCase()}
                  value={primaryUseCaseValue}
                />
                <When truthy={primaryUseCaseSelection === OTHER_OPTION_VALUE}>
                  <div className="mt-2">
                    <Input
                      label="Tell us what you'll track"
                      hideLabel
                      placeholder="Describe your use case"
                      value={primaryUseCaseOtherValue}
                      onChange={(event) =>
                        setPrimaryUseCaseOtherValue(event.target.value)
                      }
                      hideErrorText
                    />
                  </div>
                </When>
              </div>
              <div>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    How do you currently track assets?
                  </span>
                  <Select
                    value={currentSolutionSelection || undefined}
                    onValueChange={(value) => {
                      setCurrentSolutionSelection(value);
                      if (value !== OTHER_OPTION_VALUE) {
                        setCurrentSolutionOtherValue("");
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label="Select current solution"
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
                        {CURRENT_SOLUTION_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                        <SelectItem value={OTHER_OPTION_VALUE}>
                          Other
                        </SelectItem>
                      </div>
                    </SelectContent>
                  </Select>
                </label>
                <input
                  type="hidden"
                  name={zo.fields.currentSolution()}
                  value={currentSolutionValue}
                />
                <When truthy={currentSolutionSelection === OTHER_OPTION_VALUE}>
                  <div className="mt-2">
                    <Input
                      label="Share your current solution"
                      hideLabel
                      placeholder="Let us know what you use today"
                      value={currentSolutionOtherValue}
                      onChange={(event) =>
                        setCurrentSolutionOtherValue(event.target.value)
                      }
                      hideErrorText
                    />
                  </div>
                </When>
              </div>
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
