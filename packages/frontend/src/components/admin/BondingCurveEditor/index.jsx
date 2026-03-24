// src/components/admin/BondingCurveEditor/index.jsx
// Main bonding curve editor component with tabbed views

import { useEffect } from "react";
import PropTypes from "prop-types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Settings2, Table2, LineChart } from "lucide-react";

import useCurveEditor from "./useCurveEditor";
import SimpleView from "./SimpleView";
import AdvancedView from "./AdvancedView";
import GraphView from "./GraphView";

const BondingCurveEditor = ({ onChange, sofDecimals = 18 }) => {
  const editor = useCurveEditor(null, sofDecimals);

  // Notify parent of changes
  useEffect(() => {
    if (onChange && editor.steps.length > 0) {
      onChange({
        steps: editor.steps,
        maxTickets: editor.maxTickets,
        isValid: editor.isValid,
      });
    }
  }, [editor.steps, editor.maxTickets, editor.isValid, onChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Bonding Curve Configuration</label>
        <div className="flex items-center gap-2">
          {editor.isCustom && (
            <Badge variant="outline" className="text-xs">
              Custom
            </Badge>
          )}
          {!editor.isValid && (
            <Badge variant="destructive" className="text-xs">
              Invalid
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="simple" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="simple" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Simple</span>
          </TabsTrigger>
          <TabsTrigger value="advanced" className="flex items-center gap-2">
            <Table2 className="h-4 w-4" />
            <span className="hidden sm:inline">Advanced</span>
          </TabsTrigger>
          <TabsTrigger value="graph" className="flex items-center gap-2">
            <LineChart className="h-4 w-4" />
            <span className="hidden sm:inline">Graph</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="simple" className="mt-4">
          <SimpleView
            maxTickets={editor.maxTickets}
            numSteps={editor.numSteps}
            basePrice={editor.basePrice}
            priceDelta={editor.priceDelta}
            isCustom={editor.isCustom}
            setMaxTickets={editor.setMaxTickets}
            setNumSteps={editor.setNumSteps}
            setBasePrice={editor.setBasePrice}
            setPriceDelta={editor.setPriceDelta}
            resetToLinear={editor.resetToLinear}
          />
        </TabsContent>

        <TabsContent value="advanced" className="mt-4">
          <AdvancedView
            steps={editor.steps}
            maxTickets={editor.maxTickets}
            setMaxTickets={editor.setMaxTickets}
            updateStep={editor.updateStep}
            addStep={editor.addStep}
            removeStep={editor.removeStep}
            insertStepBetween={editor.insertStepBetween}
            validationErrors={editor.validationErrors}
          />
        </TabsContent>

        <TabsContent value="graph" className="mt-4">
          <GraphView
            steps={editor.steps}
            maxTickets={editor.maxTickets}
            setMaxTickets={editor.setMaxTickets}
            applyDrag={editor.applyDrag}
            addStep={editor.addStep}
            removeStep={editor.removeStep}
            updateStepPosition={editor.updateStepPosition}
            insertStepBetween={editor.insertStepBetween}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

BondingCurveEditor.propTypes = {
  onChange: PropTypes.func,
  sofDecimals: PropTypes.number,
};

export default BondingCurveEditor;
