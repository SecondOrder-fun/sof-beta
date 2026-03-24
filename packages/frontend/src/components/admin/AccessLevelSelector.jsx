/**
 * Access Level Selector
 * Admin component to configure access requirements
 */

import { useState } from "react";
import PropTypes from "prop-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_DISPLAY_NAMES,
  ACCESS_LEVEL_DESCRIPTIONS,
} from "@/config/accessLevels";

export const AccessLevelSelector = ({
  currentLevel = ACCESS_LEVELS.ADMIN,
  onLevelChange,
  title = "Open App Access Level",
  description = "Configure who can access the application",
}) => {
  const [selectedLevel, setSelectedLevel] = useState(currentLevel.toString());

  const handleChange = (value) => {
    setSelectedLevel(value);
    if (onLevelChange) {
      onLevelChange(parseInt(value));
    }
  };

  return (
    <Card className="bg-card border-primary/30">
      <CardHeader>
        <CardTitle className="text-foreground">{title}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Select value={selectedLevel} onValueChange={handleChange}>
            <SelectTrigger className="w-full bg-background border-border text-foreground">
              <SelectValue placeholder="Select access level" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {Object.entries(ACCESS_LEVELS).map(([_key, value]) => (
                <SelectItem
                  key={value}
                  value={value.toString()}
                  className="text-foreground hover:bg-primary/20 focus:bg-primary/20"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold">
                      {ACCESS_LEVEL_DISPLAY_NAMES[value]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ACCESS_LEVEL_DESCRIPTIONS[value]}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="p-3 bg-background rounded-md border border-border/30">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Current Level: </span>
              {ACCESS_LEVEL_DISPLAY_NAMES[parseInt(selectedLevel)]}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {ACCESS_LEVEL_DESCRIPTIONS[parseInt(selectedLevel)]}
            </p>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="font-semibold text-foreground">Note:</span> Changes
              take effect immediately.
            </p>
            <p>
              Access is checked against backend API and user&apos;s wallet/FID.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

AccessLevelSelector.propTypes = {
  currentLevel: PropTypes.number,
  onLevelChange: PropTypes.func,
  title: PropTypes.string,
  description: PropTypes.string,
};

export default AccessLevelSelector;
