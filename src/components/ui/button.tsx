import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Sizes and colours live in src/styles/crm.css (.crm-btn*). */
const buttonVariants = cva("crm-btn", {
    variants: {
      variant: {
        default: "crm-btn-primary",
        outline: "crm-btn-secondary",
        ghost: "crm-btn-ghost",
        destructive: "crm-btn-danger",
      },
      size: { default: "", sm: "crm-btn-sm", icon: "crm-btn-icon" },
    },
    defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
