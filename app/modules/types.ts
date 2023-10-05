export type WithDateFields<T, DateType> = {
  [K in keyof T]: K extends "createdAt" | "updatedAt" ? DateType : T[K];
};
