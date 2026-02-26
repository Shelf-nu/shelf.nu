import { Link, useLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/home";

function KpiCard({
  label,
  value,
  to,
}: {
  label: string;
  value: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex flex-1 flex-col rounded border border-color-200 bg-surface p-4 transition-colors hover:border-color-300 hover:bg-color-50 md:p-6"
    >
      <span className="text-xs font-medium text-color-600">{label}</span>
      <span className="mt-1 text-2xl font-semibold text-color-900">
        {value}
      </span>
    </Link>
  );
}

export default function KpiCards() {
  const { totalAssets, teamMembersCount, locationsCount, categoriesCount } =
    useLoaderData<typeof loader>();

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <KpiCard
        label="Total assets"
        value={totalAssets.toLocaleString()}
        to="/assets"
      />
      <KpiCard
        label="Categories"
        value={categoriesCount.toLocaleString()}
        to="/categories"
      />
      <KpiCard
        label="Locations"
        value={locationsCount.toLocaleString()}
        to="/locations"
      />
      <KpiCard
        label="Team members"
        value={teamMembersCount.toLocaleString()}
        to="/settings/team"
      />
    </div>
  );
}
