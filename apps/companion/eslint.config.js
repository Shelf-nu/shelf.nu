const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// The webapp's rule, shared so the companion cannot compare role strings
// either; role decisions come from @shelf/permissions in both apps.
const noDirectRoleChecks = require("../webapp/eslint-local-rules/no-direct-role-checks.cjs");

module.exports = defineConfig([
  ...expoConfig,
  {
    plugins: {
      "local-rules": { rules: { "no-direct-role-checks": noDirectRoleChecks } },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "local-rules/no-direct-role-checks": "error",
    },
  },
]);
