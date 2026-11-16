import { useAtomValue } from "jotai";
import { useActionData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { fileErrorAtom } from "~/atoms/file";
import { useDisabled } from "~/hooks/use-disabled";
import type { getUserWithContact } from "~/modules/user/service.server";
import type { UserPageActionData } from "~/routes/_layout+/account-details.general";
import { getValidationErrors } from "~/utils/http";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import { ChangeEmailForm } from "./change-email";
import ProfilePicture from "./profile-picture";
import FormRow from "../forms/form-row";
import { ImageFileField } from "../forms/image-file-field";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

export const UserDetailsFormSchema = z.object({
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

/**
 * "My details" card on account settings: email, username, names and the
 * profile picture upload.
 *
 * @param props.user - The signed-in user with contact details, from the loader
 */
export function UserDetailsForm({
  user,
}: {
  user: ReturnType<typeof getUserWithContact>;
}) {
  const zo = useZorm("NewQuestionWizardScreen", UserDetailsFormSchema);
  const data = useActionData<UserPageActionData>();
  const usernameError =
    getValidationErrors<typeof UserDetailsFormSchema>(data?.error)?.username
      ?.message || zo.errors.username()?.message;
  const fileError = useAtomValue(fileErrorAtom);

  const disabled = useDisabled();
  const isDisabled =
    disabled ||
    (user.sso && {
      reason: "You cannot edit your details when using SSO.",
    });

  const profilePictureError =
    (data?.error?.additionalData?.field === "profile-picture"
      ? data?.error?.message
      : undefined) ?? fileError;

  return (
    <Card className="my-0">
      <div className="mb-6">
        <h3 className="text-text-lg font-semibold">My details</h3>
        <p className="text-sm text-gray-600">
          Update your photo and personal details here.
        </p>
      </div>
      <Form
        method="post"
        ref={zo.ref}
        className=""
        replace
        encType="multipart/form-data"
      >
        <FormRow
          rowLabel={"Full name"}
          className="border-t"
          required={zodFieldIsRequired(UserDetailsFormSchema.shape.firstName)}
        >
          <div className="flex gap-6">
            <Input
              label="First name"
              autoComplete="given-name"
              type="text"
              name={zo.fields.firstName()}
              defaultValue={user?.firstName || undefined}
              error={zo.errors.firstName()?.message}
              required={zodFieldIsRequired(
                UserDetailsFormSchema.shape.firstName
              )}
              disabled={isDisabled}
            />
            <Input
              label="Last name"
              autoComplete="family-name"
              type="text"
              name={zo.fields.lastName()}
              defaultValue={user?.lastName || undefined}
              error={zo.errors.lastName()?.message}
              required={zodFieldIsRequired(
                UserDetailsFormSchema.shape.lastName
              )}
              disabled={isDisabled}
            />
          </div>
        </FormRow>
        <FormRow
          rowLabel="Email address"
          className="relative"
          required={zodFieldIsRequired(
            UserDetailsFormSchema.shape.email._def.schema
          )}
        >
          {/* Actial field used for resetting pwd and updating user */}
          <input
            type="hidden"
            name={zo.fields.email()}
            value={user?.email}
            className="hidden w-full"
          />
          {/* Just previews the email address */}
          <Input
            label={zo.fields.email()}
            autoComplete="email"
            icon="mail"
            hideLabel={true}
            placeholder="zaans@huisje.com"
            type="text"
            value={user?.email}
            className="w-full"
            disabled={true}
            title="To change your email address, please contact support."
            required={zodFieldIsRequired(
              UserDetailsFormSchema.shape.email._def.schema
            )}
          />
          <ChangeEmailForm currentEmail={user?.email} />
        </FormRow>
        <FormRow
          rowLabel="Username"
          required={zodFieldIsRequired(UserDetailsFormSchema.shape.username)}
        >
          <Input
            label="Username"
            hideLabel={true}
            addOn="shelf.nu/"
            type="text"
            name={zo.fields.username()}
            defaultValue={user?.username || undefined}
            error={usernameError}
            className="w-full"
            inputClassName="flex-1"
            required={zodFieldIsRequired(UserDetailsFormSchema.shape.username)}
            disabled={isDisabled}
          />
        </FormRow>
        <FormRow rowLabel="Profile picture" className="border-b-0">
          <ImageFileField
            name="profile-picture"
            label="Profile picture"
            currentImage={<ProfilePicture />}
            previewAlt="New profile picture"
            previewClassName="size-16 rounded-[4px] object-cover"
            error={profilePictureError}
            disabled={disabled}
          />
        </FormRow>
        <div className="text-right">
          <input type="hidden" name="type" value="updateUser" />
          <Button
            disabled={isDisabled}
            type="submit"
            name="intent"
            value="updateUser"
          >
            Save
          </Button>
        </div>
      </Form>
    </Card>
  );
}
