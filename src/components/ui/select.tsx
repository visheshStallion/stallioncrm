import * as React from "react";
import { cn } from "@/lib/utils";

/** Native select styled like shadcn inputs (accessible, works without JS). */
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "crm-select",
        className,
      )}
      {...props}
    />
  );
}
