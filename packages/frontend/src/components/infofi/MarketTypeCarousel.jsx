// src/components/infofi/MarketTypeCarousel.jsx
import PropTypes from "prop-types";
import Carousel from "@/components/common/Carousel";

/**
 * MarketTypeCarousel - Navigate between market types
 * @param {Object} props
 * @param {Array} props.marketTypes - Array of market type objects with name and count
 * @param {string} props.selectedType - Currently selected market type
 * @param {function} props.onTypeChange - Callback when type changes
 */
const MarketTypeCarousel = ({
  marketTypes = [],
  selectedType,
  onTypeChange,
}) => {
  const currentIndex = marketTypes.findIndex((mt) => mt.type === selectedType);

  const handleIndexChange = (newIndex) => {
    const marketType = marketTypes[newIndex];
    if (marketType) {
      onTypeChange(marketType.type);
    }
  };

  const renderMarketType = (marketType) => {
    return (
      <div className="flex items-center justify-center gap-3 py-2 px-6 bg-muted/50 rounded-lg border border-border">
        <div className="text-center flex-1">
          <span className="text-lg font-bold">{marketType.name}</span>
          {marketType.count > 0 && (
            <span className="ml-2 text-sm text-muted-foreground">
              ({marketType.count})
            </span>
          )}
        </div>
      </div>
    );
  };

  if (marketTypes.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        No market types available
      </div>
    );
  }

  return (
    <div className="mb-2">
      <Carousel
        items={marketTypes}
        currentIndex={currentIndex >= 0 ? currentIndex : 0}
        onIndexChange={handleIndexChange}
        renderItem={renderMarketType}
        className="w-full"
      />
    </div>
  );
};

MarketTypeCarousel.propTypes = {
  marketTypes: PropTypes.array,
  selectedType: PropTypes.string.isRequired,
  onTypeChange: PropTypes.func.isRequired,
};

export default MarketTypeCarousel;
