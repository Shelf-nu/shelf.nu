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
      fontFamily: {
        inter: ["Inter", "sans-serif"],
      },
      colors: {
        white: "#ffffff",
        black: "#000000",
        "brand-orange": "#FF7809",
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
          DEFAULT: "#EF6820",
          25: "#FEFAF5",
          50: "#FEF6EE",
          100: "#FDEAD7",
          200: "#F9DBAF",
          300: "#F7B27A",
          400: "#F38744",
          500: "#EF6820",
          600: "#EF6820",
          700: "#EF6820",
          800: "#932F19",
          900: "#772917",
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
        ring: {
          DEFAULT: "#EAF2FF",
        },
      },

      boxShadow: {
        DEFAULT: "0px 1px 2px rgba(16, 24, 40, 0.05)",
        sm: "0px 1px 3px rgba(16, 24, 40, 0.1), 0px 1px 2px rgba(16, 24, 40, 0.06)",
        md: "0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)",
        lg: "0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)",
        xl: "0px 20px 24px -4px rgba(16, 24, 40, 0.08), 0px 8px 8px -4px rgba(16, 24, 40, 0.03)",
        "2xl": "0px 24px 48px -12px rgba(16, 24, 40, 0.18)",
        "3xl": "0px 32px 64px -12px rgba(16, 24, 40, 0.14)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
    },
    container: {
      center: true,
      padding: '2rem',
    },
    animation: {
      "accordion-down": "accordion-down 0.2s ease-out",
      "accordion-up": "accordion-up 0.2s ease-out",
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/aspect-ratio"),
    require("tailwind-scrollbar"),
    require("tailwindcss-animate"),
  ],
};
