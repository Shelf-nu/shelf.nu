import { PremiumFeatureButton } from "../subscription/premium-feature-button";

export const ImportButton = ({
  canImportAssets,
}: {
  canImportAssets: boolean;
}) => (
  <PremiumFeatureButton
    canUseFeature={canImportAssets}
    buttonContent={{
      title: "Import",
      message: "Importing is not available on the free tier of shelf.",
    }}
    buttonProps={{
      to: `import`,
      variant: "secondary",
      role: "link",
    }}
  />
);
