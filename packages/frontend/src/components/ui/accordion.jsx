// src/components/ui/accordion.jsx
// shadcn-style Accordion wrapper using Radix primitives, adapted for JSX

import * as React from "react";
import PropTypes from "prop-types";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { cn } from "@/lib/utils";

// Context for sharing hover state and item registration
const AccordionContext = React.createContext(null);

const Accordion = React.forwardRef(
  ({ className, children, ...props }, ref) => {
    const [activeIndex, setActiveIndex] = React.useState(null);
    const [highlightStyle, setHighlightStyle] = React.useState({ top: 0, height: 0 });
    const itemRefs = React.useRef([]);
    const containerRef = React.useRef(null);

    const registerItem = React.useCallback((index, element) => {
      itemRefs.current[index] = element;
    }, []);

    const handleItemHover = React.useCallback((index) => {
      setActiveIndex(index);
      const item = itemRefs.current[index];
      if (item && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        setHighlightStyle({
          top: itemRect.top - containerRect.top,
          height: itemRect.height,
        });
      }
    }, []);

    const handleMouseLeave = React.useCallback(() => {
      setActiveIndex(null);
    }, []);

    return (
      <AccordionContext.Provider value={{ handleItemHover, registerItem }}>
        <div
          ref={containerRef}
          className="relative"
          onMouseLeave={handleMouseLeave}
        >
          {/* Sliding highlight indicator - always rendered, uses opacity for show/hide */}
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-0 right-0 z-10 rounded-md",
              "ring-1 ring-primary/30 bg-primary/10",
              "transition-all duration-200 ease-out",
              activeIndex !== null ? "opacity-100" : "opacity-0"
            )}
            style={{
              transform: `translateY(${highlightStyle.top}px)`,
              height: highlightStyle.height || 40,
            }}
          />
          <AccordionPrimitive.Root
            ref={ref}
            className={cn("flex flex-col gap-2", className)}
            {...props}
          >
            {React.Children.map(children, (child, index) =>
              React.isValidElement(child)
                ? React.cloneElement(child, { _index: index })
                : child
            )}
          </AccordionPrimitive.Root>
        </div>
      </AccordionContext.Provider>
    );
  }
);

Accordion.displayName = "Accordion";

Accordion.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

const AccordionItem = React.forwardRef(({ className, _index, ...props }, ref) => {
  const accordionContext = React.useContext(AccordionContext);
  const itemRef = React.useRef(null);

  // Register this item with the parent
  React.useEffect(() => {
    if (_index !== undefined && itemRef.current) {
      accordionContext?.registerItem(_index, itemRef.current);
    }
  }, [_index, accordionContext]);

  const handleMouseEnter = () => {
    if (_index !== undefined) {
      accordionContext?.handleItemHover(_index);
    }
  };

  return (
    <AccordionPrimitive.Item
      ref={(node) => {
        itemRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      onMouseEnter={handleMouseEnter}
      className={cn(
        "border border-border rounded-md bg-card transition-colors",
        className
      )}
      {...props}
    />
  );
});

AccordionItem.displayName = "AccordionItem";
AccordionItem.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
  _index: PropTypes.number,
};

const AccordionTrigger = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn(
          "flex flex-1 items-center justify-between py-2 px-3 text-sm font-medium transition-all",
          // Default: muted; Hover: foreground; Active/Open: foreground (works in both light/dark)
          "text-muted-foreground hover:text-foreground [&[data-state=open]]:text-foreground",
          "bg-transparent border-none outline-none",
          className
        )}
        {...props}
      >
        {children}
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
);

AccordionTrigger.displayName = "AccordionTrigger";
AccordionTrigger.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

const AccordionContent = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Content
      ref={ref}
      className={cn(
        "overflow-hidden text-sm text-muted-foreground",
        "data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
        className
      )}
      {...props}
    >
      <div className="px-3 pb-3 pt-1">{children}</div>
    </AccordionPrimitive.Content>
  )
);

AccordionContent.displayName = "AccordionContent";
AccordionContent.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
