// src/components/ui/date-time-picker.jsx
// DateTimePicker: Popover with Calendar grid + hour/minute selects.
// Value format: "YYYY-MM-DDTHH:mm" (same as native datetime-local).
import { useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { format, parse, setHours, setMinutes } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

// Generate hour options 0-23
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Generate minute options 0-59 in 5-minute steps
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/**
 * Themed date-time picker using Popover + Calendar + time selects.
 *
 * @param {string}   value    – "YYYY-MM-DDTHH:mm" or ""
 * @param {function} onChange – called with "YYYY-MM-DDTHH:mm" string
 * @param {string}   [label] – optional label shown on trigger when no value
 */
const DateTimePicker = ({ value, onChange, label, className }) => {
  // Parse value string into Date (or null)
  const dateValue = useMemo(() => {
    if (!value) return null;
    const d = parse(value, "yyyy-MM-dd'T'HH:mm", new Date());
    return Number.isNaN(d.getTime()) ? null : d;
  }, [value]);

  const hours = dateValue ? dateValue.getHours() : 0;
  const minutes = dateValue ? dateValue.getMinutes() : 0;

  // Format output string
  const emit = useCallback(
    (d) => {
      const pad = (n) => String(n).padStart(2, "0");
      const str = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      onChange(str);
    },
    [onChange],
  );

  const handleDaySelect = useCallback(
    (day) => {
      if (!day) return;
      // Preserve current time
      let d = setHours(day, hours);
      d = setMinutes(d, minutes);
      emit(d);
    },
    [hours, minutes, emit],
  );

  const handleHourChange = useCallback(
    (e) => {
      const h = Number(e.target.value);
      const base = dateValue || new Date();
      emit(setHours(base, h));
    },
    [dateValue, emit],
  );

  const handleMinuteChange = useCallback(
    (e) => {
      const m = Number(e.target.value);
      const base = dateValue || new Date();
      emit(setMinutes(base, m));
    },
    [dateValue, emit],
  );

  const displayText = dateValue
    ? format(dateValue, "MMM d, yyyy 'at' HH:mm")
    : label || "Pick date & time";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[210px] justify-start text-left font-normal",
            !dateValue && "text-muted-foreground",
            className,
          )}
          type="button"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{displayText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleDaySelect}
        />
        {/* Time selects */}
        <div className="flex items-center gap-2 px-3 pb-3 border-t pt-3">
          <label className="text-xs text-muted-foreground">Time:</label>
          <select
            value={hours}
            onChange={handleHourChange}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">:</span>
          <select
            value={minutes}
            onChange={handleMinuteChange}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")}
              </option>
            ))}
          </select>
        </div>
      </PopoverContent>
    </Popover>
  );
};

DateTimePicker.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
  className: PropTypes.string,
};

export { DateTimePicker };
