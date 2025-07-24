import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { useZorm } from "react-zorm";
import z from "zod";
import { Card } from "~/components/shared/card";
import { getFlagEmoji, getCountryDisplayName } from "../../utils/country";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

export const LanguageSwitchSchema = z.object({
  lng: z.string().min(2).max(5),
});

export default function LanguageSwitch({
  selectedLanguage,
}: {
  selectedLanguage: string;
}) {
  const { t } = useTranslation();
  const zo = useZorm("LanguageSwitchForm", LanguageSwitchSchema);
  const fetcher = useFetcher();
  const availableLanguages = ["en", "fr"];

  useEffect(() => {
    if (fetcher.data?.success) {
      window.location.reload();
    }
  }, [fetcher.data]);

  return (
    <Card className="my-0 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-gray-800">
          {t("languageSwitch.title")}
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          {t("languageSwitch.description")}
        </p>
      </div>

      <div className="flex flex-col">
        <fetcher.Form
          method="post"
          ref={zo.ref}
          onChange={(e) => fetcher.submit(e.currentTarget)}
        >
          <input type="hidden" name="type" value="updateLanguage" />
          <input type="hidden" name="intent" value="updateLanguage" />
          <Select name="lng" defaultValue={selectedLanguage}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {availableLanguages.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {getCountryDisplayName('es',selectedLanguage)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </fetcher.Form>
      </div>
    </Card>
  );
}
