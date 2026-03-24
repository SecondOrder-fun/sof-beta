// src/components/ui/calendar.jsx
// Themed Calendar wrapper around react-day-picker v9.
import { forwardRef } from "react";
import PropTypes from "prop-types";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

import "react-day-picker/style.css";

const Calendar = forwardRef(({ className, showOutsideDays = true, ...props }, ref) => {
  const defaults = getDefaultClassNames();

  return (
    <div ref={ref}>
      <DayPicker
        showOutsideDays={showOutsideDays}
        className={cn("p-3", className)}
        classNames={{
          root: cn(defaults.root),
          months: cn(defaults.months, "flex flex-col sm:flex-row gap-2"),
          month_caption: cn(defaults.month_caption, "flex justify-center items-center h-7 text-sm font-medium text-foreground"),
          nav: cn(defaults.nav, "flex items-center gap-1"),
          button_previous: cn(defaults.button_previous, "h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100 text-foreground"),
          button_next: cn(defaults.button_next, "h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100 text-foreground"),
          weekday: cn(defaults.weekday, "text-muted-foreground text-[0.8rem] font-normal"),
          day: cn(defaults.day, "h-8 w-8 p-0 text-sm text-foreground"),
          day_button: cn(defaults.day_button, "h-8 w-8 rounded-md hover:bg-primary/10 focus-visible:ring-1 focus-visible:ring-primary"),
          today: cn(defaults.today, "border border-primary/50 rounded-md font-semibold"),
          selected: cn(defaults.selected, "bg-primary text-primary-foreground rounded-md hover:bg-primary/90"),
          outside: cn(defaults.outside, "text-muted-foreground/50"),
          disabled: cn(defaults.disabled, "text-muted-foreground/30"),
          chevron: cn(defaults.chevron),
        }}
        components={{
          Chevron: (chevronProps) => {
            if (chevronProps.orientation === "left") {
              return <ChevronLeft className="h-4 w-4" />;
            }
            return <ChevronRight className="h-4 w-4" />;
          },
        }}
        {...props}
      />
    </div>
  );
});

Calendar.displayName = "Calendar";

Calendar.propTypes = {
  className: PropTypes.string,
  showOutsideDays: PropTypes.bool,
};

export { Calendar };
