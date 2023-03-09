module.exports = {
  content: ["./app/**/*.{ts,tsx,jsx,js}"],
  theme: {
    extend: {
      fontSize: {
        "text-xs": [
          "0.75rem",
          {
            lineHeight: "1.125rem",
          },
        ],
        "text-sm": [
          "0.875rem",
          {
            lineHeight: "1.25rem",
          },
        ],
        "text-md": [
          "1rem",
          {
            lineHeight: "1.5rem",
          },
        ],
        "text-lg": [
          "1.125rem",
          {
            lineHeight: "1.75rem",
          },
        ],
        "text-xl": [
          "1.125rem",
          {
            lineHeight: "1.75rem",
          },
        ],

        "display-xs": [
          "1.5rem",
          {
            lineHeight: "2rem",
          },
        ],
        "display-sm": [
          "1.875rem",
          {
            lineHeight: "2.375rem",
          },
        ],
        "display-md": [
          "2.25rem",
          {
            lineHeight: "2.75rem",
            letterSpacing: "-2%",
          },
        ],
        "display-lg": [
          "3rem",
          {
            lineHeight: "3.75rem",
            letterSpacing: "-2%",
          },
        ],
        "display-xl": [
          "3.75rem",
          {
            lineHeight: "4.5rem",
            letterSpacing: "-2%",
          },
        ],
        "display-2xl": [
          "4.5rem",
          {
            lineHeight: "5.625rem",
            letterSpacing: "-2%",
          },
        ],
      },
      colors: {
        white: "#ffffff",
        black: "#000000",
        gray: {
          25: "#FCFCFD",
          50: "#F9FAFB",
          100: "#F2F4F7",
          200: "#EAECF0",
          300: "#D0D5DD",
          400: "#98A2B3",
          500: "#667085",
          600: "#475467",
          700: "#344054",
          800: "#1D2939",
          900: "#101828",
        },
        primary: {
          25: "#FCFAFF",
          50: "#F9F5FF",
          100: "#F4EBFF",
          200: "#E9D7FE",
          300: "#D6BBFB",
          400: "#B692F6",
          500: "#9E77ED",
          600: "#7F56D9",
          700: "#6941C6",
          800: "#53389E",
          900: "#42307D",
        },
        error: {
          25: "#FFFBFA",
          50: "#FEF3F2",
          100: "#FEE4E2",
          200: "#FECDCA",
          300: "#FDA29B",
          400: "#F97066",
          500: "#F04438",
          600: "#D92D20",
          700: "#B42318",
          800: "#912018",
          900: "#7A271A",
        },
        warning: {
          25: "#FFFCF5",
          50: "#FFFAEB",
          100: "#FEF0C7",
          200: "#FEDF89",
          300: "#FEC84B",
          400: "#FDB022",
          500: "#F79009",
          600: "#DC6803",
          700: "#B54708",
          800: "#93370D",
          900: "#7A2E0E",
        },
        success: {
          25: "#F6FEF9",
          50: "#ECFDF3",
          100: "#D1FADF",
          200: "#A6F4C5",
          300: "#6CE9A6",
          400: "#32D583",
          500: "#12B76A",
          600: "#039855",
          700: "#027A48",
          800: "#05603A",
          900: "#054F31",
        },
      },
      fontFamily: {
        inter: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/aspect-ratio"),
    require("@tailwindcss/line-clamp"),
    require("tailwind-scrollbar"),
    require("@headlessui/tailwindcss"),
  ],
};
