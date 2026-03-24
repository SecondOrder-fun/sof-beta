// src/components/mobile/MobileMarketsList.jsx
import PropTypes from "prop-types";
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import Carousel from "@/components/common/Carousel";
import MobileMarketCard from "@/components/mobile/MobileMarketCard";
import { useUserMarketPosition } from "@/hooks/useUserMarketPosition";
import MobileCardSkeleton from "@/components/common/skeletons/MobileCardSkeleton";

/**
 * Wrapper that gives each market card a navigate onClick + position data.
 * Uses batch-provided position when available, falls back to individual hook.
 */
const MobileActiveMarketCard = ({ market, batchPosition }) => {
  const navigate = useNavigate();
  // Only call individual hook when batch data is not available
  const { data: individualPosition } = useUserMarketPosition(
    batchPosition ? null : market.id
  );
  const position = batchPosition || individualPosition;

  const hasPosition =
    !!position && (position.yesAmount > 0n || position.noAmount > 0n);
  const positionSide = hasPosition
    ? position.netPosition > 0n
      ? "YES"
      : position.netPosition < 0n
        ? "NO"
        : null
    : null;

  return (
    <MobileMarketCard
      market={market}
      onClick={() => navigate(`/markets/${market.id}`)}
      hasPosition={hasPosition}
      positionSide={positionSide}
    />
  );
};

MobileActiveMarketCard.propTypes = {
  market: PropTypes.object.isRequired,
  batchPosition: PropTypes.object,
};

/**
 * MobileMarketsList - Carousel container with adaptive height.
 * Pattern: MobileRafflesList.jsx
 */
const MobileMarketsList = ({ markets = [], isLoading, batchPositions = {} }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cardHeight, setCardHeight] = useState(null);
  const cardRef = useRef(null);

  // Reset index when markets array changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [markets]);

  // Clamp index
  useEffect(() => {
    if (currentIndex >= markets.length) {
      setCurrentIndex(0);
    }
  }, [currentIndex, markets.length]);

  // Adaptive card height (fill space above BottomNav)
  useEffect(() => {
    const update = () => {
      if (!cardRef.current) return;
      const cardTop = cardRef.current.getBoundingClientRect().top;
      const navEl = document.querySelector("nav.fixed.bottom-0");
      const navHeight = navEl ? navEl.getBoundingClientRect().height : 120;
      const h = window.innerHeight - cardTop - navHeight - 12;
      setCardHeight(h);
    };
    const timer = setTimeout(update, 100);
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", update);
    };
  }, [isLoading]);

  const handlePrevious = () => {
    if (markets.length === 0) return;
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      setCurrentIndex(markets.length - 1);
    }
  };

  const handleNext = () => {
    if (markets.length === 0) return;
    if (currentIndex < markets.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setCurrentIndex(0);
    }
  };

  // Loading
  if (isLoading) {
    return <MobileCardSkeleton />;
  }

  // Empty — parent (MobileMarkets) handles the empty state with icon + explanation
  if (markets.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Pagination controls */}
      {markets.length > 1 && (
        <div className="flex items-center justify-end gap-2">
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrevious}
              className="h-8 w-8"
              aria-label="Previous market"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              className="h-8 w-8"
              aria-label="Next market"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </ButtonGroup>
          <span className="text-sm text-muted-foreground font-mono">
            {currentIndex + 1} / {markets.length}
          </span>
        </div>
      )}

      {/* Carousel Card */}
      <Card
        ref={cardRef}
        className="flex flex-col overflow-hidden"
        style={cardHeight ? { height: cardHeight } : undefined}
      >
        <CardContent className="p-0 flex-1 overflow-hidden">
          <Carousel
            items={markets}
            currentIndex={currentIndex}
            onIndexChange={setCurrentIndex}
            className="h-full"
            showArrows={false}
            renderItem={(market) => (
              <MobileActiveMarketCard
                key={market.id}
                market={market}
                batchPosition={batchPositions[String(market.id)]}
              />
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
};

MobileMarketsList.propTypes = {
  markets: PropTypes.array,
  isLoading: PropTypes.bool,
  batchPositions: PropTypes.object,
};

export default MobileMarketsList;
