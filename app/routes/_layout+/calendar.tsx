import React from "react";
import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import { json, redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import Heading from "~/components/shared/heading";
import { tw } from "~/utils/tw";
export const loader = () => {
  const header: HeaderData = {
    title: "Calendar", // Change to an appropriate title
  };

  return json({ header });
};
const Calendar = () => {
  const { header } = useLoaderData<typeof loader>();
  return (
    <>
      <header className={tw("-mx-4 bg-white")}>
        <div className="border-b border-gray-200 p-4">
          <Heading
            as="h2"
            className="break-all text-[20px] font-semibold text-orange-500"
          >
            {header?.title}
          </Heading>
        </div>
      </header>
      <div className="mt-5">
        <FullCalendar
          plugins={[dayGridPlugin]}
          firstDay={1}
          initialView="dayGridMonth"
          editable={true}
          selectable={true}
        />
      </div>
    </>
  );
};
const calendar = () => <Calendar />;

export default calendar;
