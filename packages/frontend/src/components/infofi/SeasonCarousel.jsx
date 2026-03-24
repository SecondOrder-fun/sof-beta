// src/components/infofi/SeasonCarousel.jsx
import PropTypes from "prop-types";
import Carousel from "@/components/common/Carousel";
import { Activity } from "lucide-react";

/**
 * SeasonCarousel - Navigate between raffle seasons
 * @param {Object} props
 * @param {Array} props.seasons - Array of season objects
 * @param {string} props.selectedSeasonId - Currently selected season ID
 * @param {function} props.onSeasonChange - Callback when season changes
 */
const SeasonCarousel = ({ seasons = [], selectedSeasonId, onSeasonChange }) => {
  const currentIndex = seasons.findIndex(
    (s) => String(s.id ?? s.seasonId) === String(selectedSeasonId)
  );

  const handleIndexChange = (newIndex) => {
    const season = seasons[newIndex];
    if (season) {
      onSeasonChange(String(season.id ?? season.seasonId));
    }
  };

  const renderSeason = (season) => {
    const seasonId = season.id ?? season.seasonId;
    const isActive = Number(season.status) === 1;

    return (
      <div className="flex items-center justify-center gap-3 py-2 px-6 bg-muted/50 rounded-lg border border-border">
        <div className="text-center flex-1">
          <div className="flex items-center justify-center gap-2">
            <span className="text-lg font-bold">S{seasonId}: Test Season</span>
            {isActive && (
              <Activity
                className="h-4 w-4 text-green-500"
                aria-label="Active season"
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  if (seasons.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        No seasons available
      </div>
    );
  }

  return (
    <div className="mb-2">
      <Carousel
        items={seasons}
        currentIndex={currentIndex >= 0 ? currentIndex : 0}
        onIndexChange={handleIndexChange}
        renderItem={renderSeason}
        className="w-full"
      />
    </div>
  );
};

SeasonCarousel.propTypes = {
  seasons: PropTypes.array,
  selectedSeasonId: PropTypes.string.isRequired,
  onSeasonChange: PropTypes.func.isRequired,
};

export default SeasonCarousel;
