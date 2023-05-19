import { Link, Outlet } from "@remix-run/react";

export const handle = {
  breadcrumb: () => <Link to="/checklists">Checklist</Link>,
};


export default function ChecklistsPage() {
  return (
      <div>
        <Outlet />
      </div>
  );
}
