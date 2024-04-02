import { BookingAssetsColumn } from "./booking-assets-column";
import { BookingForm } from "./form";

export type BookingFormData = {
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  custodianUserId?: string; // This holds the ID of the user attached to custodian
  isModal?: boolean; // Determines weather the form is rendered in a modal or inside a page
};

export function BookingPageContent({
  id,
  name,
  startDate,
  endDate,
  custodianUserId,
}: BookingFormData) {
  return (
    <div
      id="bookingFormWrapper"
      className="md:mt-5 lg:flex lg:items-start lg:gap-4"
    >
      <div>
        <BookingForm
          id={id}
          name={name}
          startDate={startDate}
          endDate={endDate}
          custodianUserId={custodianUserId}
          isModal={false}
        />
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
