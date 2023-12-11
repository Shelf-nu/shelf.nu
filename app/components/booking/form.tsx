import { useMemo } from "react";
import {
  BookingStatus,
  type Asset,
  type Category,
  type Tag,
} from "@prisma/client";
import {
  Form,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { Tag as TagBadge } from "~/components/shared/tag";
import type { BookingWithCustodians } from "~/routes/_layout+/bookings._index";
import { isFormProcessing } from "~/utils/form";
import { ActionsDropdown } from "./actions-dropdown";
import { AssetImage } from "../assets/asset-image";
import CustodianSelect from "../custody/custodian-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { ChevronRight } from "../icons";
import { List } from "../list";
import { Filters } from "../list/filters";
import { Badge } from "../shared";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import TextualDivider from "../shared/textual-divider";
import { Th, Td } from "../table";

type FormData = {
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  custodianId?: string; // This holds the ID of the custodian
};

//z.coerce.date() is used to convert the string to a date object.
export const NewBookingFormSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(2, "Name is required"),
    startDate: z.coerce.date().refine((data) => data > new Date(), {
      message: "Start date must be in the future",
    }),
    endDate: z.coerce.date(),
    custodian: z.coerce
      .string()

      .transform((data) => {
        if (data === "") {
          throw new Error("Custodian is required");
        }
        return JSON.parse(data).id;
      }),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date cannot be earlier than start date.",
    path: ["endDate"],
  });

export function BookingForm({
  id,
  name,
  startDate,
  endDate,
  custodianId,
}: FormData) {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewBookingFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const routeIsNewBooking = useLocation().pathname.includes("new");

  const [, updateName] = useAtom(updateDynamicTitleAtom);
  const navigate = useNavigate();
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const hasAssets = booking.assets?.length > 0;
  const isReserved = booking.status === BookingStatus.RESERVED;

  const manageAssetsUrl = useMemo(
    () =>
      `add-assets?${new URLSearchParams({
        // We force the as String because we know that the booking.from and booking.to are strings and exist at this point.
        // This button wouldnt be available at all if there is no booking.from and booking.to
        bookingFrom: new Date(booking.from as string).toISOString(),
        bookingTo: new Date(booking.to as string).toISOString(),
        hideUnavailable: "true",
      })}`,
    [booking]
  );

  return (
    <div>
      <div className="mb-4 mt-[-42px] flex justify-end text-right">
        <div className="flex gap-3">
          {/* We only render the actions when we are not on the .new route */}
          {routeIsNewBooking ? null : <ActionsDropdown booking={booking} />}
          {/* <Button
            type="submit"
            disabled={disabled}
            variant="secondary"
            name="intent"
            value="save"
          >
            {disabled ? <Spinner /> : "Save"}
          </Button>
          <Button
            type="submit"
            disabled={disabled}
            name="intent"
            value="reserve"
          >
            {disabled ? <Spinner /> : "Reserve"}
          </Button> */}
        </div>
      </div>
      <div className="mt-5 lg:flex lg:items-start lg:gap-4">
        <div className="mb-8 mt-2 w-full lg:mb-0 lg:w-[328px]">
          <Form
            ref={zo.ref}
            method="post"
            className="flex w-full flex-col gap-3"
          >
            {id ? <input type="hidden" name="id" defaultValue={id} /> : null}
            <Card className="m-0">
              <FormRow
                rowLabel={"Name"}
                className="mobile-styling-only border-b-0 p-0"
                //@TODO required={zodFieldIsRequired(NewBookingFormSchema.shape.name)}
              >
                <Input
                  label="Name"
                  hideLabel
                  name={zo.fields.name()}
                  disabled={disabled || isReserved}
                  error={zo.errors.name()?.message}
                  autoFocus
                  onChange={updateName}
                  className="mobile-styling-only w-full p-0"
                  defaultValue={name || undefined}
                  placeholder="Booking"
                  // @TODO required={zodFieldIsRequired(NewBookingFormSchema.shape.name)}
                />
              </FormRow>
            </Card>
            <Card className="m-0 pt-0">
              <FormRow
                rowLabel={"Start Date"}
                className="mobile-styling-only border-b-0 pb-[10px]"
                // @TODO required={zodFieldIsRequired(
                //   NewBookingFormSchema.shape.startDate
                // )}
              >
                <Input
                  label="Start Date"
                  type="datetime-local"
                  hideLabel
                  name={zo.fields.startDate()}
                  disabled={disabled || isReserved}
                  error={zo.errors.startDate()?.message}
                  className="w-full"
                  defaultValue={startDate}
                  placeholder="Booking"
                  // required={zodFieldIsRequired(
                  //   NewBookingFormSchema.shape.startDate
                  // )}
                />
              </FormRow>
              <FormRow
                rowLabel={"End Date"}
                className="mobile-styling-only mb-2.5 border-b-0 p-0"
                // required={zodFieldIsRequired(NewBookingFormSchema.shape.endDate)}
              >
                <Input
                  label="End Date"
                  type="datetime-local"
                  hideLabel
                  name={zo.fields.endDate()}
                  disabled={disabled || isReserved}
                  error={zo.errors.endDate()?.message}
                  className="w-full"
                  defaultValue={endDate}
                  placeholder="Booking"
                  // required={zodFieldIsRequired(
                  //   NewBookingFormSchema.shape.endDate
                  // )}
                />
              </FormRow>
              <p className="text-[14px] text-gray-600">
                Within this period the assets in this booking will be in custody
                and unavailable for other bookings.
              </p>
            </Card>
            <Card className="m-0">
              <label className="mb-2.5 block font-medium text-gray-700">
                <span className="required-input-label">Custodian</span>
              </label>
              <CustodianSelect
                defaultCustodianId={custodianId}
                disabled={disabled || isReserved}
              />

              {zo.errors.custodian()?.message ? (
                <div className="text-sm text-error-500">
                  {zo.errors.custodian()?.message}
                </div>
              ) : null}
              <p className="mt-2 text-[14px] text-gray-600">
                The person that will be in custody of or responsible for the
                assets during the duration of the booking period.
              </p>
            </Card>
            <div className="mb-4 flex justify-end text-right">
              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={disabled}
                  variant="secondary"
                  name="intent"
                  value="save"
                >
                  Save
                </Button>

                {/* When booking is draft, we show the reserve button */}
                {booking.status === BookingStatus.DRAFT ? (
                  <Button
                    type="submit"
                    disabled={disabled || !hasAssets}
                    name="intent"
                    value="reserve"
                  >
                    Reserve
                  </Button>
                ) : null}

                {/* When booking is draft, we show the reserve check-out */}
                {booking.status === BookingStatus.RESERVED ? (
                  <Button
                    type="submit"
                    disabled={disabled}
                    name="intent"
                    value="checkOut"
                  >
                    Check-out
                  </Button>
                ) : null}
              </div>
            </div>
          </Form>
        </div>
        <div className="flex-1">
          <div className=" w-full">
            <TextualDivider text="Assets" className="mb-8 lg:hidden" />
            <div className="mb-3 flex gap-4 lg:hidden">
              <Button
                as="button"
                to={manageAssetsUrl}
                variant="primary"
                icon="plus"
                width="full"
                disabled={!booking.from || !booking.to} // If from and to are not set, we disable the button
              >
                Manage Assets
              </Button>
            </div>
            <div className="flex flex-col md:gap-2">
              <Filters className="responsive-filters mb-2 lg:mb-0">
                <div className="flex items-center justify-normal gap-6 xl:justify-end">
                  <div className="hidden lg:block">
                    <Button
                      as="button"
                      to={manageAssetsUrl}
                      variant="primary"
                      icon="plus"
                      disabled={!booking.from || !booking.to} // If from and to are not set, we disable the button
                    >
                      Manage Assets
                    </Button>
                  </div>
                </div>
              </Filters>
              <List
                ItemComponent={ListAssetContent}
                navigate={(itemId) => navigate(`/assets/${itemId}`)}
                headerChildren={
                  <>
                    <Th className="hidden md:table-cell">Category</Th>
                    <Th className="hidden md:table-cell">Tags</Th>
                  </>
                }
                customEmptyStateContent={{
                  title: "Start by defining a booking period",
                  text: "Assets added to your booking will show up here. You must select a Start and End date in order to be able to add assets to your booking.",
                  newButtonRoute: manageAssetsUrl,
                  newButtonContent: "Add assets",
                  buttonProps: {
                    disabled: !booking.from || !booking.to,
                  },
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ListAssetContent = ({
  item,
}: {
  item: Asset & {
    category?: Category;
    tags?: Tag[];
    location?: Location;
  };
}) => {
  const { category, tags } = item;
  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="h-full w-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
              <div className="font-medium">{item.title}</div>
              <div className="block md:hidden">
                {category ? (
                  <Badge color={category.color} withDot={false}>
                    {category.name}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>

          <button className="block md:hidden">
            <ChevronRight />
          </button>
        </div>
      </Td>
      <Td className="hidden md:table-cell">
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : null}
      </Td>
      <Td className="hidden text-left md:table-cell">
        <ListItemTagsColumn tags={tags} />
      </Td>
    </>
  );
};

const ListItemTagsColumn = ({ tags }: { tags: Tag[] | undefined }) => {
  const visibleTags = tags?.slice(0, 2);
  const remainingTags = tags?.slice(2);

  return tags && tags?.length > 0 ? (
    <div className="">
      {visibleTags?.map((tag) => (
        <TagBadge key={tag.name} className="mr-2">
          {tag.name}
        </TagBadge>
      ))}
      {remainingTags && remainingTags?.length > 0 ? (
        <TagBadge
          className="mr-2 w-6 text-center"
          title={`${remainingTags?.map((t) => t.name).join(", ")}`}
        >
          {`+${tags.length - 2}`}
        </TagBadge>
      ) : null}
    </div>
  ) : null;
};
