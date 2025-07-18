import { ShelfTypography } from "~/components/icons/library";
import { config } from "~/config/shelf.config";
import { useTheme } from "~/hooks/use-theme";
import { tw } from "~/utils/tw";
import When from "../when/when";

/**
 * Logo shown in the sidebar
 * If a custom logo is used, we dynamically show that or the symbol depending on {optimisticMinimizedSidebar}
 */
export const ShelfSidebarLogo = ({ minimized }: { minimized: boolean }) => {
  const { logoPath } = config;
  const theme = useTheme();

  /** If a custom logo is used, we just use that instead of doing the dynamic shelf typograpy */
  if (logoPath) {
    const symbolPath = theme === "dark" ? logoPath.symbolDark : logoPath.symbol;
    const fullLogoPath =
      theme === "dark" ? logoPath.fullLogoDark : logoPath.fullLogo;
    return minimized ? (
      <img
        src={symbolPath}
        alt="Shelf Logo"
        className="mx-1.5 inline h-[32px] transition duration-150 ease-linear"
      />
    ) : (
      <img
        src={fullLogoPath}
        alt="Shelf Logo"
        className="mx-1.5 inline h-[32px] transition duration-150 ease-linear"
      />
    );
  }

  return (
    <>
      <img
        src="/static/images/shelf-symbol.png"
        alt="Shelf Logo"
        className="mx-1.5 inline h-[32px]"
      />
      <When truthy={!minimized}>
        <span className="logo-text transition duration-150 ease-linear">
          <ShelfTypography />
        </span>
      </When>
    </>
  );
};

/**
 * Logo shown in the header for mobile screen sizes
 */
export const ShelfMobileLogo = () => {
  const { logoPath } = config;
  const theme = useTheme();

  if (logoPath) {
    const fullLogoPath =
      theme === "dark" ? logoPath.fullLogoDark : logoPath.fullLogo;
    return <img src={fullLogoPath} alt="Shelf Logo" className="h-full" />;
  }

  return (
    <img
      src="/static/images/logo-full-color(x2).png"
      alt="logo"
      className="h-full"
    />
  );
};

/**
 * Lego symbol
 */
export const ShelfSymbolLogo = ({ className }: { className?: string }) => {
  const { logoPath } = config;
  const theme = useTheme();
  const classes = tw("mx-auto mb-2 size-12", className);

  if (logoPath) {
    const symbolPath = theme === "dark" ? logoPath.symbolDark : logoPath.symbol;
    return <img src={symbolPath} alt="Shelf Logo" className={classes} />;
  }

  return (
    <img src="/static/images/shelf-symbol.png" alt="logo" className={classes} />
  );
};

/**
 * Full logo
 */
export const ShelfFullLogo = ({ className }: { className?: string }) => {
  const { logoPath } = config;
  const theme = useTheme();
  const classes = tw(className);

  if (logoPath) {
    const fullLogoPath =
      theme === "dark" ? logoPath.fullLogoDark : logoPath.fullLogo;
    return <img src={fullLogoPath} alt="Shelf Logo" className={classes} />;
  }

  return (
    <img
      src="/static/images/logo-full-color(x2).png"
      alt="logo"
      className={classes}
    />
  );
};
