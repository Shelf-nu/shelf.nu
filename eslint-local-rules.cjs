// Custom ESLint rules - Updated to support ternary expressions
module.exports = {
  "require-satisfies-on-nested-prisma-selects": require("./eslint-local-rules/require-satisfies-on-nested-prisma-selects.cjs"),
  "require-deleted-at-check-on-custom-field-queries": require("./eslint-local-rules/require-deleted-at-check-on-custom-field-queries.cjs"),
  "require-meta-export-in-routes": require("./eslint-local-rules/require-meta-export-in-routes.cjs"),
  "require-react-import-when-using-namespace": require("./eslint-local-rules/require-react-import-when-using-namespace.cjs"),
};
