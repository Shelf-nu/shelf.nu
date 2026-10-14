/**
 * Content column for wide windows.
 *
 * Wraps a screen so its content sits in the centred reading column described
 * in `lib/content-column.ts`. Navigators apply it through `screenLayout`, which
 * wraps the screen below its header: headers and the tab bar stay full width,
 * only the content is held to the column.
 *
 * The column centres itself in whatever space the screen gets, so it stays
 * centred beside the tablet sidebar as well as in a full-width window. The
 * wrapper is always rendered, a no-op on phones, so a window that crosses the
 * column width (an iPad window being resized) changes a style instead of
 * remounting the screen and losing its state.
 *
 * @see lib/content-column.ts for the column widths
 */

import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import type { ParamListBase, RouteProp } from "@react-navigation/native";
import { CONTENT_MAX_WIDTH } from "@/lib/content-column";
import { useTheme } from "@/lib/theme-context";
import { useContentGutter } from "@/lib/use-content-gutter";

/** Props for {@link ContentColumn}. */
type ContentColumnProps = {
  /** The screen to hold in the column. */
  children: ReactNode;
  /** The column's width cap, `CONTENT_MAX_WIDTH` by default. */
  maxWidth?: number;
};

/**
 * Holds its children in the centred content column. A no-op on phones.
 *
 * @param props - {@link ContentColumnProps}
 */
function ContentColumn({
  children,
  maxWidth = CONTENT_MAX_WIDTH,
}: ContentColumnProps) {
  // Only decides the background: the column itself is centred by layout.
  const isWide = useContentGutter(maxWidth) > 0;
  const { colors } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        // The space either side shows the app background. Phones have none,
        // so they keep the transparent wrapper and look exactly as before.
        backgroundColor: isWide ? colors.background : undefined,
      }}
    >
      <View style={{ flex: 1, width: "100%", maxWidth }}>{children}</View>
    </View>
  );
}

/** What a navigator's `screenLayout` receives that this module reads. */
type ScreenLayoutProps = {
  route: RouteProp<ParamListBase>;
  children: ReactElement;
};

/**
 * Builds a navigator `screenLayout` that puts every screen in the content
 * column except the routes listed.
 *
 * Leave a route out when it must use the whole window: a camera view, or a
 * nested navigator whose own screens apply the column (wrapping the navigator
 * would squeeze its headers too).
 *
 * Call it at module scope so the navigator gets a stable function.
 *
 * @param options.only - when given, wrap only these routes
 * @param options.except - routes to leave full width
 * @param options.maxWidth - the column's width cap, `CONTENT_MAX_WIDTH` by default
 * @returns a function to pass as `screenLayout`
 */
export function contentColumnLayout({
  only,
  except,
  maxWidth,
}: {
  only?: readonly string[];
  except?: readonly string[];
  maxWidth?: number;
}) {
  const onlySet = only ? new Set(only) : null;
  const exceptSet = new Set(except ?? []);

  return function ContentColumnScreenLayout({
    route,
    children,
  }: ScreenLayoutProps): ReactElement {
    const wrap =
      (onlySet === null || onlySet.has(route.name)) &&
      !exceptSet.has(route.name);
    return wrap ? (
      <ContentColumn maxWidth={maxWidth}>{children}</ContentColumn>
    ) : (
      children
    );
  };
}
