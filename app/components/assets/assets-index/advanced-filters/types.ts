export type FilterOperator =
  | "is"
  | "isNot"
  | "contains"
  | "before"
  | "after"
  | "between"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "in"
  | "containsAll"
  | "containsAny";

export type FilterDefinition = {
  string: ("is" | "isNot" | "contains")[];
  text: ["contains"];
  boolean: ["is"];
  date: ("is" | "isNot" | "before" | "after" | "between")[];
  number: ("is" | "isNot" | "gt" | "lt" | "gte" | "lte" | "between")[];
  enum: ("is" | "isNot" | "in")[];
  array: ("contains" | "containsAll" | "containsAny")[];
};
