import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { cn } from "@/lib/utils";
import type { AlertDialogProps } from "./types";

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  dismissDisabled = false,
}: AlertDialogProps) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable={!dismissDisabled}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <Modal
        className={cn(
          "border-border bg-background max-w-sm rounded-lg border p-6 shadow-lg",
          "data-[entering]:animate-in data-[entering]:fade-in data-[entering]:zoom-in-95 data-[entering]:duration-200",
          "data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-150",
          "motion-reduce:data-[entering]:animate-none motion-reduce:data-[exiting]:animate-none",
        )}
      >
        <Dialog role="alertdialog" className="flex flex-col gap-4">
          <Heading slot="title" className="text-lg font-semibold">
            {title}
          </Heading>
          <div slot="description" className="text-muted-foreground text-sm">
            {description}
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
