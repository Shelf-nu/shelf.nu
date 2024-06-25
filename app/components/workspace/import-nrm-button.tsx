import { ControlledActionButton } from "../shared/controlled-action-button";

export const ImportNrmButton = ({
  canImportNRM,
}: {
  canImportNRM: boolean;
}) => (
  <ControlledActionButton
    canUseFeature={canImportNRM}
    buttonContent={{
      title: "Import NRM",
      message: "Importing is not available on the free tier of shelf.",
    }}
    buttonProps={{
      to: `import-members`,
      variant: "secondary",
      role: "link",
      className: "whitespace-nowrap",
    }}
  />
);
