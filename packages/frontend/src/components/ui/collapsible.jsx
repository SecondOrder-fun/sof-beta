// src/components/ui/collapsible.jsx
import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import PropTypes from "prop-types";

import { cn } from "@/lib/utils";

// Context to share open state with items
const CollapsibleContext = React.createContext({ isOpen: false });

const Collapsible = React.forwardRef(
  ({ children, open, onOpenChange, defaultOpen, ...props }, ref) => {
    const [isOpen, setIsOpen] = React.useState(open ?? defaultOpen ?? false);

    const handleOpenChange = (newOpen) => {
      setIsOpen(newOpen);
      onOpenChange?.(newOpen);
    };

    React.useEffect(() => {
      if (open !== undefined) setIsOpen(open);
    }, [open]);

    return (
      <CollapsibleContext.Provider value={{ isOpen }}>
        <CollapsiblePrimitive.Root
          ref={ref}
          open={open}
          defaultOpen={defaultOpen}
          onOpenChange={handleOpenChange}
          {...props}
        >
          {children}
        </CollapsiblePrimitive.Root>
      </CollapsibleContext.Provider>
    );
  }
);

Collapsible.displayName = "Collapsible";

Collapsible.propTypes = {
  children: PropTypes.node,
  open: PropTypes.bool,
  defaultOpen: PropTypes.bool,
  onOpenChange: PropTypes.func,
};

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

const CollapsibleContent = React.forwardRef(
  ({ className, children, ...props }, ref) => {
    return (
      <CollapsiblePrimitive.CollapsibleContent
        ref={ref}
        className={cn(
          "overflow-hidden",
          "data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
          className
        )}
        {...props}
      >
        {children}
      </CollapsiblePrimitive.CollapsibleContent>
    );
  }
);

CollapsibleContent.displayName = "CollapsibleContent";

CollapsibleContent.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

// Item with staggered enter (forward) and exit (reverse) animations
const CollapsibleItem = React.forwardRef(
  ({ className, children, index = 0, totalItems = 3, ...props }, ref) => {
    const { isOpen } = React.useContext(CollapsibleContext);

    // Forward delay: first item first (100, 200, 300ms)
    const enterDelay = 100 + index * 100;
    // Reverse delay: last item first (0, 80, 160ms for items 2,1,0)
    const exitDelay = (totalItems - 1 - index) * 80;

    const delay = isOpen ? enterDelay : exitDelay;
    const animation = isOpen ? "animate-collapsible-item-in" : "animate-collapsible-item-out";

    return (
      <div
        ref={ref}
        key={isOpen ? "open" : "closed"} // Force re-mount to restart animation
        className={cn(animation, className)}
        style={{
          animationDelay: `${delay}ms`,
          animationFillMode: "both",
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CollapsibleItem.displayName = "CollapsibleItem";

CollapsibleItem.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
  index: PropTypes.number,
  totalItems: PropTypes.number,
};

export { Collapsible, CollapsibleTrigger, CollapsibleContent, CollapsibleItem };
