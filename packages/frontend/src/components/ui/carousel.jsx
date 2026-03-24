// src/components/ui/carousel.jsx
// shadcn-style carousel wrapper built on embla-carousel-react (JSX version)

import PropTypes from "prop-types";
import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { cn } from "@/lib/utils";

const CarouselContext = React.createContext(null);

export function Carousel({
  className,
  children,
  opts,
  orientation = "horizontal",
}) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    axis: orientation === "horizontal" ? "x" : "y",
    ...opts,
  });

  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  const onSelect = React.useCallback((api) => {
    if (!api) return;
    setCanScrollPrev(api.canScrollPrev());
    setCanScrollNext(api.canScrollNext());
  }, []);

  React.useEffect(() => {
    if (!emblaApi) return;
    onSelect(emblaApi);
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
  }, [emblaApi, onSelect]);

  // Split children into slides (CarouselItem) and controls (anything else)
  const childArray = React.Children.toArray(children);
  const slideChildren = [];
  const controlChildren = [];

  childArray.forEach((child) => {
    if (
      React.isValidElement(child) &&
      (child.type?.displayName === "CarouselItem" ||
        child.type?.name === "CarouselItem")
    ) {
      slideChildren.push(child);
    } else {
      controlChildren.push(child);
    }
  });

  const slideCount = slideChildren.length;

  return (
    <CarouselContext.Provider
      value={{
        emblaApi,
        canScrollPrev,
        canScrollNext,
        orientation,
        slideCount,
      }}
    >
      <div className={cn("relative", className)}>
        {controlChildren}
        <div className="overflow-hidden" ref={emblaRef}>
          <div
            className={cn(
              "flex",
              orientation === "horizontal" ? "flex-row" : "flex-col"
            )}
          >
            {slideChildren}
          </div>
        </div>
      </div>
    </CarouselContext.Provider>
  );
}

Carousel.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
  opts: PropTypes.object,
  orientation: PropTypes.oneOf(["horizontal", "vertical"]),
};

export function CarouselContent({ className, children }) {
  return <div className={cn("flex", className)}>{children}</div>;
}

CarouselContent.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

export function CarouselItem({ className, children }) {
  return (
    <div className={cn("min-w-0 shrink-0 grow-0 basis-full", className)}>
      {children}
    </div>
  );
}

CarouselItem.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};
CarouselItem.displayName = "CarouselItem";

export function CarouselPrevious({ className, ...props }) {
  const ctx = React.useContext(CarouselContext);
  const disabled = !ctx?.canScrollPrev;

  if (!ctx || (ctx.slideCount ?? 0) <= 1) return null;

  return (
    <button
      type="button"
      onClick={() => ctx.emblaApi && ctx.emblaApi.scrollPrev()}
      disabled={disabled}
      className={cn(
        "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-10 h-8 w-8 rounded-full border border-primary bg-background text-primary",
        "flex items-center justify-center text-xs hover:bg-primary/80 hover:text-white disabled:opacity-40",
        className
      )}
      {...props}
    >
      {"<"}
    </button>
  );
}

CarouselPrevious.propTypes = {
  className: PropTypes.string,
};

export function CarouselNext({ className, ...props }) {
  const ctx = React.useContext(CarouselContext);
  const disabled = !ctx?.canScrollNext;

  if (!ctx || (ctx.slideCount ?? 0) <= 1) return null;

  return (
    <button
      type="button"
      onClick={() => ctx.emblaApi && ctx.emblaApi.scrollNext()}
      disabled={disabled}
      className={cn(
        "absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-10 h-8 w-8 rounded-full border border-primary bg-background text-primary",
        "flex items-center justify-center text-xs hover:bg-primary/80 hover:text-white disabled:opacity-40",
        className
      )}
      {...props}
    >
      {">"}
    </button>
  );
}

CarouselNext.propTypes = {
  className: PropTypes.string,
};
