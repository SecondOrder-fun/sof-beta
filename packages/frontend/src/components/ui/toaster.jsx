import { useState } from 'react';
import PropTypes from 'prop-types';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { Check, Copy, X } from 'lucide-react';
import { Toast, ToastTitle, ToastDescription } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';

// Default auto-dismiss for every toast (ms). Callers can override per-toast
// by passing { duration } to `toast(...)`. 8s is long enough to read and
// hit the copy button before the toast slides out.
const DEFAULT_TOAST_DURATION = 8000;

/**
 * Per-toast item with a "copy" affordance. Toast text isn't user-selectable
 * inside the Radix viewport (the swipe-to-dismiss gesture intercepts pointer
 * events), so a copy button is the only way to capture the message for
 * debugging — paste into Slack, a bug report, etc.
 */
function ToastItem({ title, description, action, ...props }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    // Don't let the click bubble up and dismiss the toast.
    e.stopPropagation();
    const text = [title, description].filter(Boolean).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write fails silently in private browsing; the user can
      // still try the browser-native context menu as a fallback.
    }
  };

  // pr-16 so the title/description stop short of the absolute button group.
  return (
    <Toast duration={DEFAULT_TOAST_DURATION} className="pr-16" {...props}>
      <div className="grid gap-1">
        {title && <ToastTitle>{title}</ToastTitle>}
        {description && <ToastDescription>{description}</ToastDescription>}
      </div>
      {/*
        Pinned to the top-right corner so they don't shift vertically with
        single- vs multi-line toast content. Compact `h-6 w-6` outline icon
        buttons matching the visual scale of small inline controls elsewhere.
      */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy message'}
          className="h-6 w-6 shrink-0"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
        <ToastPrimitive.Close asChild>
          <Button
            size="icon"
            variant="outline"
            aria-label="Dismiss"
            className="h-6 w-6 shrink-0"
          >
            <X className="h-3 w-3" />
          </Button>
        </ToastPrimitive.Close>
      </div>
      {action}
    </Toast>
  );
}

ToastItem.propTypes = {
  title: PropTypes.node,
  description: PropTypes.node,
  action: PropTypes.node,
};

const Toaster = () => {
  const { toasts } = useToast();

  return (
    <ToastPrimitive.Provider>
      <div className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} />
        ))}
      </div>
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[101] m-0 flex w-full max-w-[420px] flex-col gap-2 p-4 outline-none sm:m-0" />
    </ToastPrimitive.Provider>
  );
};

export { Toaster };