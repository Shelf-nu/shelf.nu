import { redirect, type LoaderArgs, json } from "@remix-run/node";
import { Form } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { getAuthSession } from "~/modules/auth";

const OnboardingFormSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email.")
    .transform((email) => email.toLowerCase()),
  username: z
    .string()
    .min(4, { message: "Must be at least 4 characters long" }),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const title = "Onboarding";
  const subHeading =
    "You are almost ready to use Shelf. We just need some basic information to get you started.";
  if (authSession) return redirect("/assets");
  return json({ title, subHeading });
}

export default function Onboarding() {
  const zo = useZorm("NewQuestionWizardScreen", OnboardingFormSchema);

  return (
    <div>
      <Form>
        <div className="flex gap-6">
          <Input
            label="First name"
            type="text"
            name={zo.fields.firstName()}
            error={zo.errors.firstName()?.message}
          />
          <Input
            label="Last name"
            type="text"
            name={zo.fields.lastName()}
            error={zo.errors.lastName()?.message}
          />
        </div>
      </Form>
    </div>
  );
}
