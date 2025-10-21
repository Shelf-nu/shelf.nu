// Custom ESLint rules for Shelf.nu
module.exports = {
  "require-satisfies-on-nested-prisma-selects": require("./require-satisfies-on-nested-prisma-selects.cjs"),
  "require-deleted-at-check-on-custom-field-queries": require("./require-deleted-at-check-on-custom-field-queries.cjs"),
};
