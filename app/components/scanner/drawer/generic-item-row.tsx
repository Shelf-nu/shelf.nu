// components/scanner/generic-item-row.tsx
import { motion } from "framer-motion";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import { tw } from "~/utils/tw";

// Type for the row props
type GenericItemRowProps<T> = {
  qrId: string;
  item: T | null;
  onRemove: (qrId: string) => void;
  renderItem: (item: T) => React.ReactNode;
  renderLoading: (qrId: string, error?: string) => React.ReactNode;
  hasError?: boolean;
  error?: string;
};

/**
 * Generic component for rendering a row in the scanned items table
 */
export function GenericItemRow<T>({
  qrId,
  item,
  onRemove,
  renderItem,
  renderLoading,
  hasError,
  error,
}: GenericItemRowProps<T>) {
  return (
    <Tr>
      <Td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          {!item || hasError ? renderLoading(qrId, error) : renderItem(item)}
        </div>
      </Td>
      <Td>
        <Button
          className="border-none text-gray-500 hover:text-gray-700"
          variant="ghost"
          icon="trash"
          onClick={() => onRemove(qrId)}
        />
      </Td>
    </Tr>
  );
}

// Animation wrapper for rows
export function Tr({ children }: { children: React.ReactNode }) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: -80 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      exit={{ opacity: 0 }}
      className="h-[80px] items-center border-b hover:bg-gray-50 [&_td]:border-b-0"
      style={{
        transform: "translateZ(0)",
        willChange: "transform",
        backgroundAttachment: "initial",
      }}
    >
      {children}
    </motion.tr>
  );
}

// Default loading state component
export function TextLoader({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <div className={tw("loading-text", className)}>{text}...</div>;
}

export function DefaultLoadingState({
  qrId,
  error,
}: {
  qrId: string;
  error?: string;
}) {
  return (
    <div className="max-w-full">
      <p>
        QR id: <span className="font-semibold">{qrId}</span>
      </p>{" "}
      {error ? (
        <p className="whitespace-normal text-[12px] text-error-500">{error}</p>
      ) : (
        <TextLoader
          text="Fetching item"
          className="text-[10px] text-gray-500"
        />
      )}
    </div>
  );
}
