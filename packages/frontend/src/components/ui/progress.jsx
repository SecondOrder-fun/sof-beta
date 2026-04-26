import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import PropTypes from "prop-types"

import { cn } from "@/lib/utils"

/**
 * Progress bar with optional step markers.
 *
 * @param {number} value - 0–100 percentage
 * @param {Array<{position: number, label?: string, sublabel?: string}>} steps
 *   Each step has a `position` (0–100), optional `label` (e.g. "0.0042 SOF"),
 *   and optional `sublabel` (e.g. "Step #3"). Dots render on top of the bar.
 * @param {string} className - Applied to the bar itself
 */
const Progress = React.forwardRef(
  ({ className, value, steps, ...props }, ref) => {
    const [tip, setTip] = React.useState(null)
    // Suppress transition on first render so the bar doesn't animate from 0
    const [mounted, setMounted] = React.useState(false)
    React.useEffect(() => { setMounted(true) }, [])

    const bar = (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn(
          // bg-track-rest is light rose in BOTH modes (see tailwind.css for
          // --track-rest). In dark mode soften to 70% alpha so the rose
          // doesn't overpower the dark page bg — same pattern the Switch
          // off-state uses, scoped here in a primitive (the only places
          // dark: appears in the codebase).
          // Height matches the bordered step-marker outer diameter so
          // begin/end markers feel like the bar's end-caps.
          "relative h-3 w-full overflow-hidden rounded-full border border-primary bg-track-rest dark:bg-track-rest/70",
          className,
        )}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn("h-full w-full flex-1 bg-primary", mounted && "transition-all")}
          style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
        />
      </ProgressPrimitive.Root>
    )

    if (!steps || steps.length === 0) return bar

    return (
      <div className="relative" onMouseLeave={() => setTip(null)}>
        {bar}
        {/* Step markers — sit on top of the bar, vertically centered.
            Middle markers center on their position (-translate-x-1/2);
            the FIRST and LAST sit fully inside the bar (left edge at 0%,
            right edge at 100%) so they don't protrude past the rounded
            ends.
            Markers in the FILLED section get a 1px page-bg ring so they
            read as bullseyes against the pink fill — except the leftmost
            (idx 0), which stays a plain bg-primary dot so it blends with
            the bar's primary border as a continuous end-cap.
            Markers in the EMPTY section sit on the rose track without a
            ring (the bg-primary dot already contrasts). */}
        {steps.map((step, idx) => {
          if (step.position > 100) return null
          const isFirst = idx === 0
          const isLast = idx === steps.length - 1
          const inFilled = step.position <= (value || 0)
          const showRing = inFilled && !isFirst
          return (
            <div
              key={idx}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary shadow-sm cursor-help",
                // Inset first/last fully inside the bar; center the rest.
                isFirst ? "translate-x-0" : isLast ? "-translate-x-full" : "-translate-x-1/2",
                showRing && "border border-background",
              )}
              style={{ left: `${step.position}%` }}
              onMouseEnter={() => setTip({ ...step, idx })}
            />
          )
        })}
        {/* Tooltip */}
        {tip && (
          <div
            className="absolute -top-11 -translate-x-1/2 px-2 py-1 rounded-md bg-popover text-popover-foreground text-xs border shadow-md pointer-events-none z-10"
            style={{ left: `${tip.position}%` }}
            role="tooltip"
          >
            {tip.label && <div className="font-mono">{tip.label}</div>}
            {tip.sublabel && (
              <div className="text-[10px] text-muted-foreground">
                {tip.sublabel}
              </div>
            )}
          </div>
        )}
      </div>
    )
  },
)
Progress.displayName = ProgressPrimitive.Root.displayName

Progress.propTypes = {
  className: PropTypes.string,
  value: PropTypes.number,
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      position: PropTypes.number.isRequired,
      label: PropTypes.string,
      sublabel: PropTypes.string,
    })
  ),
}

export { Progress }
