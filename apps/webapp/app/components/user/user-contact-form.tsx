import { useActionData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import type { getUserWithContact } from "~/modules/user/service.server";
import type { UserPageActionData } from "~/routes/_layout+/account-details.general";
import { getValidationErrors } from "~/utils/http";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

export const UserContactDetailsFormSchema = z.object({
  phone: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  zipPostalCode: z.string().optional(),
  countryRegion: z.string().optional(),
});
export function UserContactDetailsForm({
  user,
}: {
  user: ReturnType<typeof getUserWithContact>;
}) {
  const zo = useZorm("UserContactDetailsForm", UserContactDetailsFormSchema);
  const actionData = useActionData<UserPageActionData>();
  const disabled = useDisabled();
  const isDisabled =
    disabled ||
    (user.sso && {
      reason: "You cannot edit your details when using SSO.",
    });
  const validationErrors = getValidationErrors<
    typeof UserContactDetailsFormSchema
  >(actionData?.error);

  return (
    <Card className="my-0">
      <div className="mb-6">
        <h3 className="text-text-lg font-semibold">Contact Information</h3>
        <p className="text-sm text-color-600">
          Update your contact details and address information here. This
          information will be visible to other users within your workspace and
          may be used for communication purposes.
        </p>
      </div>
      <Form method="post" ref={zo.ref} className="" replace>
        <FormRow
          rowLabel="Phone number"
          className="border-t"
          required={zodFieldIsRequired(
            UserContactDetailsFormSchema.shape.phone
          )}
        >
          <Input
            label="Phone"
            type="tel"
            autoComplete="tel"
            hideLabel
            name={zo.fields.phone()}
            defaultValue={user?.contact?.phone || undefined}
            error={
              validationErrors?.phone?.message || zo.errors.phone()?.message
            }
            placeholder="+1 (555) 123-4567"
            required={zodFieldIsRequired(
              UserContactDetailsFormSchema.shape.phone
            )}
            disabled={isDisabled}
          />
        </FormRow>

        <FormRow
          rowLabel="Street address"
          required={zodFieldIsRequired(
            UserContactDetailsFormSchema.shape.street
          )}
        >
          <Input
            label="Street"
            type="text"
            autoComplete="street-address"
            name={zo.fields.street()}
            defaultValue={user?.contact?.street || undefined}
            error={
              validationErrors?.street?.message || zo.errors.street()?.message
            }
            hideLabel
            placeholder="123 Main Street"
            required={zodFieldIsRequired(
              UserContactDetailsFormSchema.shape.street
            )}
            disabled={isDisabled}
          />
        </FormRow>

        <FormRow
          rowLabel="City"
          required={zodFieldIsRequired(UserContactDetailsFormSchema.shape.city)}
        >
          <Input
            label="City"
            type="text"
            hideLabel
            autoComplete="city"
            name={zo.fields.city()}
            defaultValue={user?.contact?.city || undefined}
            error={validationErrors?.city?.message || zo.errors.city()?.message}
            placeholder="San Francisco"
            required={zodFieldIsRequired(
              UserContactDetailsFormSchema.shape.city
            )}
            disabled={isDisabled}
          />
        </FormRow>

        <FormRow
          rowLabel="State/Province and Postal Code"
          required={zodFieldIsRequired(
            UserContactDetailsFormSchema.shape.stateProvince
          )}
        >
          <div className="flex gap-6">
            <Input
              label="State/Province"
              hideLabel
              autoComplete="state"
              type="text"
              name={zo.fields.stateProvince()}
              defaultValue={user?.contact?.stateProvince || undefined}
              error={
                validationErrors?.stateProvince?.message ||
                zo.errors.stateProvince()?.message
              }
              placeholder="California"
              required={zodFieldIsRequired(
                UserContactDetailsFormSchema.shape.stateProvince
              )}
              disabled={isDisabled}
            />
            <Input
              label="ZIP/Postal Code"
              type="text"
              hideLabel
              autoComplete="postal-code"
              name={zo.fields.zipPostalCode()}
              defaultValue={user?.contact?.zipPostalCode || undefined}
              error={
                validationErrors?.zipPostalCode?.message ||
                zo.errors.zipPostalCode()?.message
              }
              placeholder="94102"
              required={zodFieldIsRequired(
                UserContactDetailsFormSchema.shape.zipPostalCode
              )}
              disabled={isDisabled}
            />
          </div>
        </FormRow>

        <FormRow
          rowLabel="Country/Region"
          className="border-b-0 pb-0"
          required={zodFieldIsRequired(
            UserContactDetailsFormSchema.shape.countryRegion
          )}
        >
          <Input
            label="Country/Region"
            type="text"
            hideLabel
            autoComplete="country"
            name={zo.fields.countryRegion()}
            defaultValue={user?.contact?.countryRegion || undefined}
            error={
              validationErrors?.countryRegion?.message ||
              zo.errors.countryRegion()?.message
            }
            placeholder="United States"
            required={zodFieldIsRequired(
              UserContactDetailsFormSchema.shape.countryRegion
            )}
            disabled={isDisabled}
          />
        </FormRow>

        <div className="text-right">
          <input type="hidden" name="type" value="updateUserContact" />
          <Button
            disabled={isDisabled}
            type="submit"
            name="intent"
            value="updateUserContact"
          >
            Save
          </Button>
        </div>
      </Form>
    </Card>
  );
}
