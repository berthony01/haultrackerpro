export const toast = Object.assign(
  (m: unknown) => console.log('toast', m),
  {
    success: (m: unknown) => console.log('toast.success', m),
    error: (m: unknown) => console.log('toast.error', m),
    info: (m: unknown) => console.log('toast.info', m),
    warning: (m: unknown) => console.log('toast.warning', m),
    message: (m: unknown) => console.log('toast.message', m),
    dismiss: () => {},
  },
);
export const Toaster = () => null;
export default toast;
