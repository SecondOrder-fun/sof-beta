import * as ToastPrimitive from '@radix-ui/react-toast';
import { Toast, ToastTitle, ToastDescription } from '@/components/ui/toast';
import { useToast } from '@/hooks/useToast';

const Toaster = () => {
  const { toasts } = useToast();

  return (
    <ToastPrimitive.Provider>
      <div className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]">
        {toasts.map(function ({ id, title, description, action, ...props }) {
          return (
            <Toast key={id} {...props}>
              <div className="grid gap-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
              {action}
            </Toast>
          );
        })}
      </div>
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[101] m-0 flex w-full max-w-[420px] flex-col gap-2 p-4 outline-none sm:m-0" />
    </ToastPrimitive.Provider>
  );
};

export { Toaster };