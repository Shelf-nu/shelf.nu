import { useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { useSearchParams } from "~/hooks/search-params";
import Agreement from "./agreement";
import { Button } from "../shared/button";

export const AGREEMENT_POPUP_VISIBLE = "show-agreement-popup";

export default function AgreementPopup({
  templateName,
}: {
  templateName: String;
}) {
  const [params, setParams] = useSearchParams();
  const isMobileView = params.get(AGREEMENT_POPUP_VISIBLE) || false;
  const handleBackdropClose = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      params.delete(AGREEMENT_POPUP_VISIBLE);
      setParams(params);
    },
    [params, setParams]
  );

  return (
    <AnimatePresence>
      {isMobileView ? (
        <div
          className="dialog-backdrop !bg-[#364054]/70"
          onClick={handleBackdropClose}
        >
          <div className="flex h-fit max-h-[90vh] w-[90vw] flex-col overflow-y-auto rounded-md border-b-DEFAULT border-b-gray-500 bg-white">
            <div className="flex items-center justify-between p-4">
              <div>
                <div className="text-lg font-semibold text-gray-800">
                  Leaving signature
                </div>
                <div className="text-gray-600">{templateName}</div>
              </div>
              <Button
                onClick={handleBackdropClose}
                className="text-gray-700"
                icon="x"
                variant="link"
              />
            </div>
            <Agreement />
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
