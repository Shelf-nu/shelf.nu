import { PremiumFeatureButton } from "../subscription/premium-feature-button";

export const ExportButton = ({
  canExportAssets,
}: {
  canExportAssets: boolean;
}) => (
  <PremiumFeatureButton
    canUseFeature={canExportAssets}
    buttonContent={{
      title: "Export",
      message: "Exporting is not available on the free tier of shelf.",
    }}
    buttonProps={{
      to: `export/assets-${new Date().toISOString().slice(0, 10)}.csv`,
      variant: "secondary",
      role: "link",
      download: true,
      reloadDocument: true,
    }}
  />
);
