import * as React from "react";
import { composeRenderProps, Input as InputPrimitive } from "react-aria-components";

import { cn } from "@/lib/utils";

const IGNORE_PWD_MNG_PROPS = {
  "data-1p-ignore": true,
  "data-bwignore": true,
  "data-lpignore": true,
  "data-form-type": "other",
};

function Input({ className, autoComplete, ...props }: React.ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      data-slot="input"
      className={composeRenderProps(className, (className) =>
        cn(
          "border-input file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
          className,
        ),
      )}
      autoComplete={autoComplete}
      {...(!autoComplete && IGNORE_PWD_MNG_PROPS)}
      {...props}
    />
  );
}

export { Input };
