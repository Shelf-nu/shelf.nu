import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { FunctionComponent } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Search } from "lucide-react";
import { Button } from "~/components/shared/button";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import { ChevronRight } from "../icons/library";

type PendingAudit = {
  id: string;
  name: string;
  createdAt: Date;
  expectedAssetCount: number;
  createdBy: {
    firstName: string | null;
    lastName: string | null;
  };
  assignments: Array<{
    user: {
      firstName: string | null;
      lastName: string | null;
    };
  }>;
};

export interface AuditSelectorProps {
  audits: PendingAudit[];
  name?: string;
  placeholder?: string;
  defaultValue?: string;
  className?: string;
  disabled?: boolean;
  error?: string;
  isLoading?: boolean;
}

const AuditSelector: FunctionComponent<AuditSelectorProps> = ({
  audits,
  name,
  placeholder = "Select an audit",
  defaultValue,
  className,
  disabled,
  error,
  isLoading = false,
}) => {
  const [selectedAudit, setSelectedAudit] = useState<string | undefined>(
    defaultValue
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedAudit(defaultValue);
  }, [defaultValue]);

  // Auto-focus search input when popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    } else {
      setSearchQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const filteredAudits = useMemo(() => {
    if (!searchQuery) return audits;

    return audits.filter((audit) =>
      audit.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [audits, searchQuery]);

  const selectedAuditName = audits.find((audit) => audit.id === selectedAudit)
    ?.name;

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setSelectedIndex(0);
  };

  const handleSelect = (auditId: string) => {
    setSelectedAudit(auditId);
    setIsOpen(false);
    setSearchQuery("");
  };

  const scrollToIndex = (index: number) => {
    setTimeout(() => {
      const selectedElement = document.getElementById(`audit-option-${index}`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev < filteredAudits.length - 1 ? prev + 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev > 0 ? prev - 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "Enter":
        event.preventDefault();
        if (filteredAudits[selectedIndex]) {
          handleSelect(filteredAudits[selectedIndex].id);
        }
        break;
    }
  };

  const displayText = selectedAuditName || placeholder;

  return (
    <div className={className}>
      <input type="hidden" name={name} value={selectedAudit || ""} />

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className={tw(
              "w-full justify-start truncate whitespace-nowrap font-normal [&_span]:max-w-full [&_span]:truncate",
              !selectedAuditName && "text-color-400"
            )}
            disabled={disabled || isLoading}
          >
            <ChevronRight className="ml-[2px] inline-block shrink-0 rotate-90" />
            <span className="ml-2">{displayText}</span>
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className={tw(
              "z-[999999] mt-2 max-h-[400px] w-[500px] overflow-scroll rounded-md border border-color-200 bg-surface shadow-lg"
            )}
          >
            <div className="flex items-center border-b">
              <Search className="ml-4 size-4 text-color-500" />
              <input
                ref={searchInputRef}
                placeholder="Search audits..."
                className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
                value={searchQuery}
                onChange={handleSearch}
                onKeyDown={handleKeyDown}
              />
            </div>
            {filteredAudits.length > 0 ? (
              filteredAudits.map((audit, index) => {
                const creatorName =
                  audit.createdBy.firstName || audit.createdBy.lastName
                    ? `${audit.createdBy.firstName || ""} ${
                        audit.createdBy.lastName || ""
                      }`.trim()
                    : "Unknown";

                const assigneeName =
                  audit.assignments.length > 0
                    ? `${audit.assignments[0].user.firstName || ""} ${
                        audit.assignments[0].user.lastName || ""
                      }`.trim()
                    : "Unassigned";

                return (
                  <div
                    id={`audit-option-${index}`}
                    key={audit.id}
                    className={tw(
                      "border-b px-4 py-3 hover:cursor-pointer hover:bg-color-50",
                      selectedIndex === index && "bg-color-50"
                    )}
                    role="option"
                    aria-selected={selectedIndex === index}
                    tabIndex={0}
                    onClick={() => handleSelect(audit.id)}
                    onKeyDown={handleActivationKeyPress(() =>
                      handleSelect(audit.id)
                    )}
                  >
                    <div className="font-semibold text-color-900">
                      {audit.name}
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5 text-xs text-color-600">
                      <span>Created by: {creatorName}</span>
                      <span>Assignee: {assigneeName}</span>
                      <span>Expected assets: {audit.expectedAssetCount}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-4 py-3 text-sm text-color-500">
                {isLoading
                  ? "Loading audits..."
                  : searchQuery
                  ? "No audits found"
                  : "No pending audits found"}
              </div>
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      {error && <p className="mt-2 text-sm text-error-500">{error}</p>}
    </div>
  );
};

export default AuditSelector;
