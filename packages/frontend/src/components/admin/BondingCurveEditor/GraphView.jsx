// src/components/admin/BondingCurveEditor/GraphView.jsx
// Interactive graph view with draggable control points using Visx

import { useState, useMemo, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { localPoint } from "@visx/event";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Minus, PlusCircle } from "lucide-react";

// Chart dimensions
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 300;
const MARGIN = { top: 20, right: 30, bottom: 40, left: 60 };

const GraphView = ({
  steps,
  maxTickets,
  setMaxTickets,
  applyDrag: _applyDrag,
  addStep,
  removeStep,
  updateStepPosition,
  insertStepBetween,
}) => {
  const svgRef = useRef(null);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [ghostSteps, setGhostSteps] = useState(null);
  // Shift-select state: array of selected indices (max 2)
  const [selectedIndices, setSelectedIndices] = useState([]);

  // Draft state for max tickets input
  const [draftMaxTickets, setDraftMaxTickets] = useState(null);

  const handleMaxTicketsChange = useCallback((e) => {
    const raw = e.target.value;
    setDraftMaxTickets(raw);
    const n = Number(raw);
    if (raw !== "" && !Number.isNaN(n) && n >= 1) setMaxTickets(n);
  }, [setMaxTickets]);

  const handleMaxTicketsBlur = useCallback(() => {
    if (draftMaxTickets === null) return;
    const n = Number(draftMaxTickets);
    if (draftMaxTickets === "" || Number.isNaN(n) || n < 1) {
      setMaxTickets(maxTickets);
    }
    setDraftMaxTickets(null);
  }, [draftMaxTickets, setMaxTickets, maxTickets]);

  // Chart bounds
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  // Control points (step transition points)
  const controlPoints = useMemo(() => {
    return steps.map((step, i) => ({
      x: step.rangeTo,
      y: step.price,
      index: i,
      isFirst: i === 0,
      isLast: i === steps.length - 1,
    }));
  }, [steps]);

  // Scales
  const xScale = useMemo(() => {
    return scaleLinear({
      domain: [0, maxTickets],
      range: [0, innerWidth],
      nice: true,
    });
  }, [maxTickets, innerWidth]);

  const yScale = useMemo(() => {
    const maxPrice = Math.max(...steps.map((s) => s.price), 1);
    const minPrice = Math.min(...steps.map((s) => s.price), 0);
    const padding = (maxPrice - minPrice) * 0.1 || 1;

    return scaleLinear({
      domain: [Math.max(0, minPrice - padding), maxPrice + padding],
      range: [innerHeight, 0],
      nice: true,
    });
  }, [steps, innerHeight]);

  // Check if two selected indices are adjacent
  const selectedAreAdjacent = useMemo(() => {
    if (selectedIndices.length !== 2) return false;
    const [a, b] = selectedIndices.sort((x, y) => x - y);
    return b - a === 1;
  }, [selectedIndices]);

  // Get the lower index of selected pair (for insert)
  const insertAfterIndex = useMemo(() => {
    if (!selectedAreAdjacent) return null;
    return Math.min(...selectedIndices);
  }, [selectedAreAdjacent, selectedIndices]);

  // Handle drag start (normal click without shift)
  const handleDragStart = useCallback((index, event) => {
    // If shift key is held, handle selection instead of drag
    if (event.shiftKey) {
      event.preventDefault();
      setSelectedIndices((prev) => {
        if (prev.includes(index)) {
          // Deselect if already selected
          return prev.filter((i) => i !== index);
        }
        if (prev.length >= 2) {
          // Replace oldest selection
          return [prev[1], index];
        }
        return [...prev, index];
      });
      return;
    }

    // Clear selection when starting a drag
    setSelectedIndices([]);
    event.preventDefault();
    setDraggingIndex(index);
    setGhostSteps([...steps]);
  }, [steps]);

  // Handle drag move - now supports X and Y axis
  const handleDragMove = useCallback((event) => {
    if (draggingIndex === null || !svgRef.current) return;

    const point = localPoint(svgRef.current, event);
    if (!point) return;

    // Convert screen coordinates to data values
    const newPrice = yScale.invert(point.y - MARGIN.top);
    const newRangeTo = xScale.invert(point.x - MARGIN.left);

    // Guard against undefined/NaN values
    if (newPrice === undefined || newRangeTo === undefined ||
        Number.isNaN(newPrice) || Number.isNaN(newRangeTo)) {
      return;
    }

    const clampedPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);

    // Use updateStepPosition for full X+Y movement
    updateStepPosition(draggingIndex, newRangeTo, clampedPrice);
  }, [draggingIndex, yScale, xScale, updateStepPosition]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setDraggingIndex(null);
    setGhostSteps(null);
  }, []);

  // Mouse/touch event handlers for SVG
  const handleMouseMove = useCallback((event) => {
    if (draggingIndex !== null) {
      handleDragMove(event);
    }
  }, [draggingIndex, handleDragMove]);

  const handleMouseUp = useCallback(() => {
    if (draggingIndex !== null) {
      handleDragEnd();
    }
  }, [draggingIndex, handleDragEnd]);

  const handleMouseLeave = useCallback(() => {
    if (draggingIndex !== null) {
      handleDragEnd();
    }
    setHoverIndex(null);
  }, [draggingIndex, handleDragEnd]);

  // Handle inserting a step between selected nodes
  const handleInsertBetween = useCallback(() => {
    if (insertAfterIndex !== null) {
      insertStepBetween(insertAfterIndex);
      setSelectedIndices([]); // Clear selection after insert
    }
  }, [insertAfterIndex, insertStepBetween]);

  // Clear selection when clicking on background
  const handleBackgroundClick = useCallback((event) => {
    // Only clear if clicking directly on the SVG background
    if (event.target === event.currentTarget || event.target.tagName === "rect") {
      setSelectedIndices([]);
    }
  }, []);

  // Build path for stepped line
  const buildSteppedPath = useCallback((stepsData) => {
    if (!stepsData || stepsData.length === 0) return "";

    const firstY = yScale(stepsData[0].price);
    if (firstY === undefined || Number.isNaN(firstY)) return "";

    let d = `M 0 ${firstY}`;

    for (let i = 0; i < stepsData.length; i++) {
      const step = stepsData[i];
      const x = xScale(step.rangeTo);
      const y = yScale(step.price);
      const prevY = i > 0 ? yScale(stepsData[i - 1].price) : y;

      // Skip if any value is undefined/NaN
      if (x === undefined || y === undefined || prevY === undefined ||
          Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(prevY)) {
        continue;
      }

      // Horizontal then vertical (stepped)
      d += ` L ${x} ${prevY}`;
      d += ` L ${x} ${y}`;
    }

    return d;
  }, [xScale, yScale]);

  // Build area path for fill
  const buildAreaPath = useCallback((stepsData) => {
    if (!stepsData || stepsData.length === 0) return "";

    const baseline = innerHeight;
    const firstY = yScale(stepsData[0].price);
    if (firstY === undefined || Number.isNaN(firstY)) return "";

    let d = `M 0 ${baseline}`;
    d += ` L 0 ${firstY}`;

    for (let i = 0; i < stepsData.length; i++) {
      const step = stepsData[i];
      const x = xScale(step.rangeTo);
      const y = yScale(step.price);
      const prevY = i > 0 ? yScale(stepsData[i - 1].price) : y;

      // Skip if any value is undefined/NaN
      if (x === undefined || y === undefined || prevY === undefined ||
          Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(prevY)) {
        continue;
      }

      d += ` L ${x} ${prevY}`;
      d += ` L ${x} ${y}`;
    }

    // Close to baseline
    const lastX = xScale(stepsData[stepsData.length - 1].rangeTo);
    if (lastX !== undefined && !Number.isNaN(lastX)) {
      d += ` L ${lastX} ${baseline}`;
    }
    d += " Z";

    return d;
  }, [xScale, yScale, innerHeight]);

  // Handle removing the last step (except first)
  const handleRemoveLastStep = useCallback(() => {
    if (steps.length > 1) {
      removeStep(steps.length - 1);
    }
  }, [steps.length, removeStep]);

  if (!steps || steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] border rounded-lg bg-muted/30">
        <span className="text-muted-foreground">No curve data</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Drag to adjust
          </Badge>
          {selectedIndices.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {selectedIndices.length} selected
            </Badge>
          )}
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Max:</label>
            <Input
              type="number"
              min={1}
              value={draftMaxTickets !== null ? draftMaxTickets : maxTickets}
              onChange={handleMaxTicketsChange}
              onBlur={handleMaxTicketsBlur}
              className="font-mono h-7 w-24 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draggingIndex !== null && (
            <Badge variant="secondary" className="text-xs">
              Adjusting Step {draggingIndex + 1}
            </Badge>
          )}
          {/* Insert button when two adjacent nodes are selected */}
          {selectedAreAdjacent && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleInsertBetween}
              className="h-7 px-2 gap-1"
              title="Insert step between selected"
            >
              <PlusCircle className="h-3 w-3" />
              <span className="text-xs">Insert Between</span>
            </Button>
          )}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemoveLastStep}
              disabled={steps.length <= 1}
              className="h-7 w-7 p-0"
              title="Remove last step"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Badge variant="outline" className="font-mono text-xs px-2">
              {steps.length} steps
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addStep}
              className="h-7 w-7 p-0"
              title="Add step"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <div className="border rounded-lg bg-background overflow-hidden">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="select-none"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchMove={(e) => handleDragMove(e.touches[0])}
          onTouchEnd={handleDragEnd}
          onClick={handleBackgroundClick}
        >
          <Group left={MARGIN.left} top={MARGIN.top}>
            {/* Clickable background for clearing selection */}
            <rect
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
            />

            {/* Grid */}
            <GridRows
              scale={yScale}
              width={innerWidth}
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
              numTicks={5}
            />
            <GridColumns
              scale={xScale}
              height={innerHeight}
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
              numTicks={5}
            />

            {/* Ghost line (original curve during drag) */}
            {ghostSteps && draggingIndex !== null && (
              <path
                d={buildSteppedPath(ghostSteps)}
                fill="none"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.5}
              />
            )}

            {/* Area fill */}
            <path
              d={buildAreaPath(steps)}
              fill="hsl(var(--primary))"
              fillOpacity={0.15}
            />

            {/* Stepped line */}
            <path
              d={buildSteppedPath(steps)}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
            />

            {/* Visual indicator for insert position */}
            {selectedAreAdjacent && insertAfterIndex !== null && (
              <g>
                {/* Dashed line between selected points */}
                <line
                  x1={xScale(steps[insertAfterIndex].rangeTo)}
                  y1={yScale(steps[insertAfterIndex].price)}
                  x2={xScale(steps[insertAfterIndex + 1].rangeTo)}
                  y2={yScale(steps[insertAfterIndex + 1].price)}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
                {/* Midpoint indicator */}
                <circle
                  cx={xScale((steps[insertAfterIndex].rangeTo + steps[insertAfterIndex + 1].rangeTo) / 2)}
                  cy={yScale((steps[insertAfterIndex].price + steps[insertAfterIndex + 1].price) / 2)}
                  r={4}
                  fill="#3b82f6"
                  stroke="hsl(var(--background))"
                  strokeWidth={1}
                  opacity={0.8}
                />
              </g>
            )}

            {/* Control points */}
            {controlPoints.map((point, i) => {
              const cx = xScale(point.x);
              const cy = yScale(point.y);
              const isActive = draggingIndex === i || hoverIndex === i;
              const isSelected = selectedIndices.includes(i);
              const isXFixed = point.isLast; // Last node can't move horizontally

              return (
                <g key={i}>
                  {/* Larger invisible hit area */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={15}
                    fill="transparent"
                    style={{ cursor: isXFixed ? "ns-resize" : "move" }}
                    onMouseDown={(e) => handleDragStart(i, e)}
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseLeave={() => setHoverIndex(null)}
                    onTouchStart={(e) => handleDragStart(i, e.touches[0])}
                  />

                  {/* Selection ring */}
                  {isSelected && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={12}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      strokeDasharray="3 2"
                    />
                  )}

                  {/* Visible point */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isActive ? 8 : 6}
                    fill={isSelected ? "#3b82f6" : isActive ? "hsl(var(--primary))" : "hsl(var(--background))"}
                    stroke={isSelected ? "#3b82f6" : "hsl(var(--primary))"}
                    strokeWidth={2}
                    style={{
                      cursor: isXFixed ? "ns-resize" : "move",
                      transition: "r 0.1s ease",
                    }}
                    pointerEvents="none"
                  />

                  {/* X-fixed indicator for last node */}
                  {isXFixed && isActive && (
                    <line
                      x1={cx}
                      y1={cy - 15}
                      x2={cx}
                      y2={cy + 15}
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      opacity={0.7}
                    />
                  )}

                  {/* Price/position label on hover/drag */}
                  {isActive && (
                    <g>
                      <rect
                        x={cx + 10}
                        y={cy - 35}
                        width={90}
                        height={30}
                        rx={4}
                        fill="hsl(var(--card))"
                        opacity={0.95}
                      />
                      <text
                        x={cx + 55}
                        y={cy - 21}
                        textAnchor="middle"
                        fill="hsl(var(--foreground))"
                        fontSize={10}
                        fontFamily="monospace"
                      >
                        {point.y.toFixed(2)} SOF
                      </text>
                      <text
                        x={cx + 55}
                        y={cy - 9}
                        textAnchor="middle"
                        fill="hsl(var(--muted-foreground))"
                        fontSize={9}
                        fontFamily="monospace"
                      >
                        @{point.x.toLocaleString()}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Axes */}
            <AxisLeft
              scale={yScale}
              stroke="hsl(var(--muted-foreground))"
              tickStroke="hsl(var(--muted-foreground))"
              tickLabelProps={() => ({
                fill: "hsl(var(--muted-foreground))",
                fontSize: 10,
                textAnchor: "end",
                dy: "0.33em",
                dx: -4,
              })}
              label="Price (SOF)"
              labelProps={{
                fill: "hsl(var(--muted-foreground))",
                fontSize: 11,
                textAnchor: "middle",
              }}
              labelOffset={40}
            />
            <AxisBottom
              scale={xScale}
              top={innerHeight}
              stroke="hsl(var(--muted-foreground))"
              tickStroke="hsl(var(--muted-foreground))"
              tickLabelProps={() => ({
                fill: "hsl(var(--muted-foreground))",
                fontSize: 10,
                textAnchor: "middle",
                dy: 4,
              })}
              label="Tickets Sold"
              labelProps={{
                fill: "hsl(var(--muted-foreground))",
                fontSize: 11,
                textAnchor: "middle",
              }}
              labelOffset={25}
              tickFormat={(v) => {
                if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
                return v.toString();
              }}
            />
          </Group>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full border-2 border-primary bg-background" />
          <span>Drag to adjust</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full border-2 border-info bg-info" />
          <span>Shift+click to select</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 h-0.5 bg-primary" />
          <span>Bonding curve</span>
        </div>
      </div>
    </div>
  );
};

GraphView.propTypes = {
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      rangeTo: PropTypes.number.isRequired,
      price: PropTypes.number.isRequired,
    })
  ).isRequired,
  maxTickets: PropTypes.number.isRequired,
  setMaxTickets: PropTypes.func.isRequired,
  applyDrag: PropTypes.func.isRequired,
  addStep: PropTypes.func.isRequired,
  removeStep: PropTypes.func.isRequired,
  updateStepPosition: PropTypes.func.isRequired,
  insertStepBetween: PropTypes.func.isRequired,
};

export default GraphView;
