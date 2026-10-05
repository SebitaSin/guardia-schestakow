import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-md border border-border bg-surface px-3 text-base text-fg placeholder:text-subtle shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)] md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
