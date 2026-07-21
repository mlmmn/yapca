import {
  composeRenderProps,
  RadioGroup as RadioGroupPrimitive,
  Radio as RadioPrimitive,
  type RadioGroupProps,
  type RadioProps,
} from "react-aria-components";
import { cn } from "@/lib/utils";

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn("grid w-full gap-2", className)} {...props} />;
}

function RadioGroupItem({ className, children, ...props }: RadioProps) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- shadcn aria-nova registry component; RadioField/RadioButton migration is out of scope here
    <RadioPrimitive
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-focus-visible:border-ring data-focus-visible:ring-ring/50 data-invalid:border-destructive data-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:data-invalid:border-destructive/50 dark:data-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary/5 data-selected:border-primary data-selected:bg-primary/5 relative flex w-full cursor-pointer items-start gap-3 rounded-lg border p-2.5 outline-none focus-visible:ring-3 aria-invalid:ring-3 data-focus-visible:ring-3 data-invalid:ring-3 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="radio-group-indicator"
            className={cn(
              "border-input relative mt-0.5 flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border",
              isSelected && "border-primary bg-primary",
            )}
          >
            {isSelected && (
              <span className="bg-primary-foreground absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
            )}
          </span>
          <span className="flex flex-1 flex-col gap-0.5">{children}</span>
        </>
      ))}
    </RadioPrimitive>
  );
}

export { RadioGroup, RadioGroupItem };
