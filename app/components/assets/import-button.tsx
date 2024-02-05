import { ControlledActionButton } from "../shared/controlled-action-button";

export const ImportButton = ({
  canImportAssets,
}: {
  canImportAssets: boolean;
}) => (
  <ControlledActionButton
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
