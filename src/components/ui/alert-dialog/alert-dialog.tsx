import type { ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { cn } from "@/lib/utils";

export type AlertDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  cancelAction?: ReactNode;
  confirmAction?: ReactNode;
  children?: ReactNode;
  isDismissDisabled?: boolean;
};

export function AlertDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  isDismissDisabled = false,
}: AlertDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!isDismissDisabled}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <Modal
        className={cn(
          "border-border bg-background max-w-sm rounded-lg border p-6 shadow-lg",
          "animate-in fade-in zoom-in-95 duration-200",
          "prefers-reduced-motion:animate-none",
        )}
      >
        <Dialog role="alertdialog" className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="text-muted-foreground text-sm">{description}</div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
