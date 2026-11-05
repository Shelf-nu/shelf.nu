const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// The webapp's rule, shared so the companion cannot compare role strings
// either; role decisions come from @shelf/permissions in both apps.
const noDirectRoleChecks = require("../webapp/eslint-local-rules/no-direct-role-checks.cjs");
const noClippedUserText = require("./eslint-local-rules/no-clipped-user-text.cjs");

module.exports = defineConfig([
  ...expoConfig,
  {
    plugins: {
      "local-rules": {
        rules: {
          "no-direct-role-checks": noDirectRoleChecks,
          "no-clipped-user-text": noClippedUserText,
        },
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "local-rules/no-direct-role-checks": "error",
      "local-rules/no-clipped-user-text": "error",
      // eslint-config-expo turns on eslint-plugin-react-hooks' React Compiler
      // rules. The app does not build with the React Compiler and uses the
      // patterns they flag throughout (refs read during render, setState in
      // effects), so they stay off until the app adopts the compiler.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
    },
  },
]);
