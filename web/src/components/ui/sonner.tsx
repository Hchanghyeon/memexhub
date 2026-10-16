import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return (
    <Sonner theme={dark ? "dark" : "light"} position="bottom-center" richColors closeButton className="toaster group"
      style={{ "--normal-bg": "var(--popover)", "--normal-text": "var(--popover-foreground)", "--normal-border": "var(--border)" } as React.CSSProperties}
      {...props} />
  );
}
export { Toaster };
