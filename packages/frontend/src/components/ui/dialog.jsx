// src/components/ui/dialog.jsx
// shadcn/ui-style dialog built on Radix primitives.
// API matches AdminPanel.jsx imports: Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter

import * as DialogPrimitive from '@radix-ui/react-dialog';
import PropTypes from 'prop-types';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

// Root re-export to keep usage: <Dialog open onOpenChange>...
const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));

DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;
DialogOverlay.propTypes = {
  className: PropTypes.string,
};

const DialogContent = forwardRef(({ className = '', children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg sm:zoom-in-90 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));

DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className = '', ...props }) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);

const DialogFooter = ({ className = '', ...props }) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
);

const DialogTitle = forwardRef(({ className = '', ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));

DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = forwardRef(({ className = '', ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));

DialogDescription.displayName = DialogPrimitive.Description.displayName;

Dialog.propTypes = {
  open: PropTypes.bool,
  onOpenChange: PropTypes.func,
  children: PropTypes.node,
};

DialogContent.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

DialogHeader.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

DialogTitle.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

DialogDescription.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

DialogFooter.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
