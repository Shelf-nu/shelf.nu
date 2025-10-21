module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allow longer body lines since we auto-wrap them in prepare-commit-msg hook
    "body-max-line-length": [2, "always", 100],
    // Keep subject line limit reasonable
    "header-max-length": [2, "always", 100],
  },
};
