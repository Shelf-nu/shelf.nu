module.exports = {
  content: ["./app/**/*.{ts,tsx,jsx,js}"],
  theme: {
    extend: {
      fontSize: {
        h1: ["var(--font-size-h1)", "1.2"],
        h2: ["var(--font-size-h2)", "1.2"],
        h3: ["var(--font-size-h3)", "1.2"],
        h4: ["var(--font-size-h4)", "1.2"],
        h5: ["var(--font-size-h5)", "1.2"],
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/aspect-ratio"),
    require("tailwind-scrollbar"),
  ],
};
