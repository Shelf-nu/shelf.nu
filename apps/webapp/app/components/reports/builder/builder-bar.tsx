/**
 * The three choices that define a custom report: data, group by, measure.
 *
 * Each choice is a select whose options come from the closed lists in
 * `spec.ts`; the custom-field grouping expands into one option per
 * filterable custom field of the workspace. Changing a choice rewrites the
 * spec into the URL (keeping filters and timeframe), which reloads the
 * report. Changing the data set keeps the grouping and measure when the new
 * data set supports them.
 *
 * @see {@link file://../../../modules/reports/builder/spec.ts}
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 */

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { useSearchParams } from "~/hooks/search-params";
import {
  BUILDER_DATASETS,
  DATASET_DESCRIPTIONS,
  DATASET_GROUP_BYS,
  DATASET_LABELS,
  DATASET_MEASURES,
  GROUP_BY_LABELS,
  MEASURE_LABELS,
  encodeGroupBy,
  withDataset,
  writeBuilderSpec,
  type BuilderDataset,
  type BuilderMeasure,
  type BuilderSpec,
} from "~/modules/reports/builder/spec";
import type { ReportCustomFieldOption } from "~/modules/reports/types";

/** Props for {@link BuilderBar}. */
type Props = {
  /** The spec currently shown (after any server-side fallback). */
  spec: BuilderSpec;
  /** Custom fields the workspace can group by. */
  customFields: ReportCustomFieldOption[];
  /** Disables the selects while a navigation is in flight. */
  disabled?: boolean;
};

const CUSTOM_FIELD_PREFIX = "customField:";

/** Renders the Data / Group by / Measure selects. */
export function BuilderBar({ spec, customFields, disabled }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const apply = (next: BuilderSpec) => {
    setSearchParams(writeBuilderSpec(searchParams, next), { replace: true });
  };

  const groupByValue = encodeGroupBy(spec.groupBy, spec.customFieldId);

  const handleGroupByChange = (value: string) => {
    if (value.startsWith(CUSTOM_FIELD_PREFIX)) {
      apply({
        ...spec,
        groupBy: "customField",
        customFieldId: value.slice(CUSTOM_FIELD_PREFIX.length),
      });
      return;
    }
    apply({
      ...spec,
      groupBy: value as BuilderSpec["groupBy"],
      customFieldId: null,
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded border border-gray-200 bg-white px-4 py-3 md:flex-row md:items-end md:gap-4">
      <BuilderSelect
        label="Data"
        value={spec.dataset}
        disabled={disabled}
        onValueChange={(value) =>
          apply(withDataset(spec, value as BuilderDataset))
        }
      >
        {BUILDER_DATASETS.map((dataset) => (
          <SelectItem key={dataset} value={dataset} className="px-4 py-2">
            <span className="block text-sm font-medium text-gray-900">
              {DATASET_LABELS[dataset]}
            </span>
            <span className="block text-xs text-gray-500">
              {DATASET_DESCRIPTIONS[dataset]}
            </span>
          </SelectItem>
        ))}
      </BuilderSelect>

      <BuilderSelect
        label="Group by"
        value={groupByValue}
        disabled={disabled}
        onValueChange={handleGroupByChange}
      >
        {DATASET_GROUP_BYS[spec.dataset]
          .filter((groupBy) => groupBy !== "customField")
          .map((groupBy) => (
            <SelectItem key={groupBy} value={groupBy} className="px-4 py-2">
              <span className="block text-sm text-gray-900">
                {GROUP_BY_LABELS[groupBy]}
              </span>
            </SelectItem>
          ))}
        {customFields.map((field) => (
          <SelectItem
            key={field.id}
            value={`${CUSTOM_FIELD_PREFIX}${field.id}`}
            className="px-4 py-2"
          >
            <span className="block text-sm text-gray-900">
              {GROUP_BY_LABELS.customField}: {field.name}
            </span>
          </SelectItem>
        ))}
        <SelectItem value="none" className="px-4 py-2">
          <span className="block text-sm text-gray-900">
            {GROUP_BY_LABELS.none}
          </span>
        </SelectItem>
      </BuilderSelect>

      <BuilderSelect
        label="Measure"
        value={spec.measure}
        disabled={disabled}
        onValueChange={(value) =>
          apply({ ...spec, measure: value as BuilderMeasure })
        }
      >
        {DATASET_MEASURES[spec.dataset].map((measure) => (
          <SelectItem key={measure} value={measure} className="px-4 py-2">
            <span className="block text-sm text-gray-900">
              {MEASURE_LABELS[measure]}
            </span>
          </SelectItem>
        ))}
      </BuilderSelect>
    </div>
  );
}

/** One labelled select in the bar. */
function BuilderSelect({
  label,
  value,
  disabled,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-[200px] flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          aria-label={label}
          className="px-3 py-2 text-left text-sm text-gray-900"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          className="min-w-[260px] p-0"
        >
          <div className="max-h-[320px] overflow-auto py-1">{children}</div>
        </SelectContent>
      </Select>
    </label>
  );
}
