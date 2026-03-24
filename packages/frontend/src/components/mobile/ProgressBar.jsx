/**
 * Progress Bar
 * Segmented progress indicator for tickets sold visualization
 */

import PropTypes from "prop-types";

export const ProgressBar = ({ current, max, className = "" }) => {
  const percentage = max > 0 ? (Number(current) / Number(max)) * 100 : 0;
  const segments = 10;
  const filledSegments = Math.ceil((percentage / 100) * segments);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex gap-1">
        {Array.from({ length: segments }).map((_, index) => (
          <div
            key={index}
            className={`flex-1 h-2 rounded-full transition-colors ${
              index < filledSegments ? "bg-primary" : "bg-border/30"
            }`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{current.toString()} sold</span>
        <span>{max.toString()} max</span>
      </div>
    </div>
  );
};

ProgressBar.propTypes = {
  current: PropTypes.oneOfType([PropTypes.number, PropTypes.bigint]).isRequired,
  max: PropTypes.oneOfType([PropTypes.number, PropTypes.bigint]).isRequired,
  className: PropTypes.string,
};

export default ProgressBar;
