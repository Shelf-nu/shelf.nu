import { ShelfTypography } from "~/components/icons/library";
import { config } from "~/config/shelf.config";

/**
 * Logo shown in the sidebar
 * If a custom logo is used, we dynamically show that or the symbol depending on {optimisticMinimizedSidebar}
 */
export const ShelfSidebarLogo = ({ minimized }: { minimized: boolean }) => {
  const { logoPath } = config;

  /** If a custom logo is used, we just use that instead of doing the dynamic shelf typograpy */
  if (logoPath) {
    return minimized ? (
      <img
        src={logoPath.symbol}
        alt="Shelf Logo"
        className="mx-1.5 inline h-[32px] transition duration-150 ease-linear"
      />
    ) : (
      <img
        src={logoPath.fullLogo}
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
      <span className="logo-text transition duration-150 ease-linear">
        <ShelfTypography />
      </span>
    </>
  );
};

/**
 * Logo shown in the header for mobile screen sizes
 */
export const ShelfMobileLogo = () => {
  const { logoPath } = config;

  if (logoPath) {
    return <img src={logoPath.fullLogo} alt="Shelf Logo" className="h-full" />;
  }

  return (
    <img
      src="/static/images/logo-full-color(x2).png"
      alt="logo"
      className="h-full"
    />
  );
};
