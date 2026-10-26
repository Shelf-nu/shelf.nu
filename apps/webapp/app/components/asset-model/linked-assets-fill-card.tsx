/**
 * "Fill linked assets" card on the asset model edit page.
 *
 * A model's defaults only fill assets as they join it, so assets already in
 * the model keep their empty fields. This card shows how many of them have
 * empty fields the defaults would fill, and offers to fill them once. It never
 * replaces a value an asset already has.
 *
 * @see {@link file://./../../routes/_layout+/settings.asset-models.$assetModelId_.edit.tsx}
 * @see {@link file://./../../modules/asset-model/defaults.server.ts}
 */
import { Form } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import type { LinkedAssetsFillSummary } from "~/modules/asset-model/defaults.server";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

/**
 * Renders the card, or nothing when no linked asset has a field to fill.
 *
 * @param props.summary - What the fill would change, from the loader
 */
export function LinkedAssetsFillCard({
  summary,
}: {
  summary: LinkedAssetsFillSummary;
}) {
  const disabled = useDisabled();

  if (summary.assetCount === 0) {
    return null;
  }

  const assetsLabel =
    summary.assetCount === 1 ? "1 asset" : `${summary.assetCount} assets`;

  return (
    <Card className="m-0 w-full lg:max-w-[880px]">
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="fillLinkedAssets" />
        <div>
          <h3 className="text-[16px] font-semibold">
            {assetsLabel} in this model{" "}
            {summary.assetCount === 1 ? "has" : "have"} empty fields its
            defaults can fill
          </h3>
          <p className="text-[14px] text-gray-600">
            Defaults only fill assets as they join the model. You can fill the
            assets already in it now. Values they already have stay as they are.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-gray-700">
          {summary.fields.map((field) => (
            <li key={field.label}>
              <b>{field.label}</b>: {field.count}{" "}
              {field.count === 1 ? "asset" : "assets"}
            </li>
          ))}
        </ul>
        <div>
          <Button type="submit" variant="secondary" disabled={disabled}>
            {disabled ? "Filling..." : `Fill empty fields on ${assetsLabel}`}
          </Button>
        </div>
      </Form>
    </Card>
  );
}
