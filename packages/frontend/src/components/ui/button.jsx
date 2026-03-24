import React from 'react';
import PropTypes from 'prop-types';
import { cn } from '@/lib/utils';

/**
 * Button component with pointer-event-driven pressed state.
 * Uses data-pressed attribute instead of CSS :active to prevent
 * sticky active states on mobile/Farcaster touch UIs.
 */
const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const resolvedVariant =
    variant === 'primary'
      ? 'default'
      : variant === 'danger'
        ? 'destructive'
        : variant;
  const Comp = asChild ? 'span' : 'button';

  const handlePointerDown = (e) => {
    e.currentTarget.dataset.pressed = '';
    props.onPointerDown?.(e);
  };
  const handlePointerUp = (e) => {
    delete e.currentTarget.dataset.pressed;
    props.onPointerUp?.(e);
  };
  const handlePointerLeave = (e) => {
    delete e.currentTarget.dataset.pressed;
    props.onPointerLeave?.(e);
  };

  return (
    <Comp
      className={cn(
        'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background',
        // Primary button: white text on Cochineal Red, Fabric Red on hover, pressed darker
        resolvedVariant === 'default' && 'bg-primary text-white hover:bg-primary/80 data-[pressed]:bg-primary/60',
        resolvedVariant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // Outline: Cochineal Red text, white bg, Fabric Red border
        resolvedVariant === 'outline' && 'border border-primary/80 text-primary bg-background hover:bg-primary/10 data-[pressed]:bg-primary/20',
        // Cancel: Cochineal Red border, white text on Cement bg
        resolvedVariant === 'cancel' && 'border border-primary text-white bg-muted-foreground hover:bg-muted-foreground/80 data-[pressed]:bg-primary data-[pressed]:text-black',
        // Secondary button: White text on Fabric Red bg
        resolvedVariant === 'secondary' && 'bg-primary/80 text-white border border-primary hover:bg-primary/70 data-[pressed]:bg-primary/60',
        resolvedVariant === 'ghost' && 'border border-primary text-muted bg-primary/80 hover:bg-primary/70 data-[pressed]:bg-primary/60 dark:text-fabric-red dark:bg-pastel-rose',
        resolvedVariant === 'link' && 'bg-transparent text-muted-foreground underline underline-offset-4 hover:text-primary hover:bg-transparent',
        // External brand variants — colors are fixed third-party brand values
        resolvedVariant === 'farcaster' && 'bg-[#7c3aed] text-white hover:bg-[#6d28d9] hover:scale-105 transition-transform',
        resolvedVariant === 'base' && 'bg-[#0052ff] text-white hover:bg-[#003ecb] hover:scale-105 transition-transform',
        (size === 'default' || !size) && 'h-10 py-2 px-4',
        size === 'sm' && 'h-9 px-3 rounded-md',
        size === 'lg' && 'h-11 px-8 rounded-md',
        size === 'icon' && 'h-9 w-9 p-0',
        className
      )}
      ref={ref}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      {...props}
    />
  );
});

Button.displayName = 'Button';

Button.propTypes = {
  className: PropTypes.string,
  variant: PropTypes.oneOf([
    'default',
    'primary',
    'secondary',
    'outline',
    'cancel',
    'ghost',
    'link',
    'destructive',
    'danger',
    'farcaster',
    'base',
  ]),
  size: PropTypes.oneOf(['default', 'sm', 'lg', 'icon']),
  asChild: PropTypes.bool,
  onPointerDown: PropTypes.func,
  onPointerUp: PropTypes.func,
  onPointerLeave: PropTypes.func,
};

export { Button };