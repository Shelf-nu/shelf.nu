export const getCountryDisplayName = (
  countryCode: string,
  languageCode: string
) => {
  const regionNames = new Intl.DisplayNames(languageCode, { type: "language" });

  const displayName = regionNames.of(countryCode);
  return displayName
    ? displayName.charAt(0).toUpperCase() + displayName.slice(1)
    : "";
};
