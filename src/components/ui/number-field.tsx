import * as React from "react";
import {
  composeRenderProps,
  Group,
  NumberField as NumberFieldPrimitive,
  type NumberFieldProps,
} from "react-aria-components";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

function NumberField({ className, ...props }: NumberFieldProps) {
  return <NumberFieldPrimitive data-slot="number-field" className={cn("w-full", className)} {...props} />;
}

function NumberFieldGroup({ className, ...props }: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="number-field-group"
      className={composeRenderProps(className, (className) =>
        cn(
          "border-input focus-within:border-ring focus-within:ring-ring/50 flex h-8 w-full items-center gap-1.5 rounded-lg border bg-transparent pr-2.5 transition-colors focus-within:ring-3",
          className,
        ),
      )}
      {...props}
    />
  );
}

function NumberFieldInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input data-slot="number-field-input" className={cn("border-0 focus-visible:ring-0", className)} {...props} />;
}

function NumberFieldSuffix({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="number-field-suffix"
      className={cn("text-muted-foreground pointer-events-none text-sm select-none", className)}
      {...props}
    />
  );
}

export { NumberField, NumberFieldGroup, NumberFieldInput, NumberFieldSuffix };
