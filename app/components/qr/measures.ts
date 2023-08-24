export const FONT_SIZE_MAP = {
  cable: 0,
  small: 4,
  medium: 5,
  large: 8,
};

export const LOGO_SIZE_MAP = {
  cable: 0,
  small: 4.96,
  medium: 7.44,
  large: 9.92,
};

export const CANVAS_DIMENSIONS_MAP = {
  cable: 0,
  small: 75.6,
  medium: 113.38,
  large: 151.18,
};

export const QR_DIMENSIONS_MAP = Object.keys(CANVAS_DIMENSIONS_MAP).reduce(
  (acc, size) => ({
    [size]: CANVAS_DIMENSIONS_MAP[size as never] * 0.95,
    ...acc,
  }),
  {} as typeof CANVAS_DIMENSIONS_MAP
);

export const MARGINS = {
  cable: [0, 0],
  small: [2, 3.5],
  medium: [1, 3.25],
  large: [0, 4],
};
