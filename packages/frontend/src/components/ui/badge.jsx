import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";
import PropTypes from "prop-types";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        success:
          "border-transparent bg-success text-success-foreground hover:bg-success/80",
        warning:
          "border-transparent bg-warning text-warning-foreground hover:bg-warning/80",
        info:
          "border-transparent bg-info text-info-foreground hover:bg-info/80",
        outline: "text-foreground",
        // Status variants for raffle and system states
        statusActive:
          "bg-[#0b1020] border-[#233b7a] text-[#d1e4ff] hover:bg-[#111832]",
        statusCompleted:
          "bg-[#082016] border-[#2ea96f] text-[#c7f2dd] hover:bg-[#0d2b1f]",
        statusUpcoming:
          "bg-[#17171f] border-[#4b5563] text-[#e5e7eb] hover:bg-[#1f2933]",
        statusSettling:
          "bg-warning/15 text-warning hover:bg-warning/15 border-warning/30",
        statusDanger:
          "bg-[#2b0008] border-[#f04455] text-[#fecaca] hover:bg-[#3b000d]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

// forwardRef so Radix primitives (e.g. Tooltip's `asChild` Trigger) can attach
// a ref to the underlying DOM node — needed by the Origin badge in the
// portfolio transactions table.
const Badge = forwardRef(function Badge({ className, variant, ...props }, ref) {
  return (
    <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  );
});

Badge.displayName = "Badge";

Badge.propTypes = {
  className: PropTypes.string,
  variant: PropTypes.oneOf([
    "default",
    "secondary",
    "destructive",
    "success",
    "warning",
    "info",
    "outline",
    "statusActive",
    "statusCompleted",
    "statusUpcoming",
    "statusSettling",
    "statusDanger",
  ]),
};

export { Badge };
