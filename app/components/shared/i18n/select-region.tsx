import { useState, useEffect } from "react";
import { Globe } from "lucide-react";
import { setLocale, getLocale } from "~/paraglide/runtime";

const SelectRegion = () => {
  const [currentLocale, setCurrentLocale] = useState(getLocale());

  const locales = [
    { code: "en", name: "English" },
    { code: "fr", name: "Français" },
  ];

  const handleChangeLocale = (event: { target: { value: any } }) => {
    const newLocale = event.target.value;

    console.log("Selected locale:", newLocale);
    setLocale(newLocale);
    setCurrentLocale(newLocale);
    // refresh the page with the new cookie
    window.location.reload();
  };

  // Sync state with paraglide if locale changes elsewhere
  useEffect(() => {
    const locale = getLocale();
    if (locale !== currentLocale) {
      setCurrentLocale(locale);
    }
  }, [currentLocale]);

  return (
    <div className="flex items-center space-x-2 rounded-lg bg-gray-100 p-4">
      <Globe size={20} className="text-gray-600" />
      <select
        value={currentLocale}
        onChange={handleChangeLocale}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Select language"
      >
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SelectRegion;
