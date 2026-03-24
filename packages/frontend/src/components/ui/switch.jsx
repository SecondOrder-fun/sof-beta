import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import PropTypes from "prop-types";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // Default shadcn/ui classes with justify-start for proper thumb positioning
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center justify-start rounded-full border-2 border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      // Cochineal Red when checked, muted when unchecked
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-secondary",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // Default shadcn/ui classes
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

Switch.propTypes = {
  className: PropTypes.string,
};

export { Switch };
