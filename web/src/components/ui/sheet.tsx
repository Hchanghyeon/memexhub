import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
function SheetContent({ className, children, side = "left", ...props }: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
      <SheetPrimitive.Content data-slot="sheet-content" className={cn("bg-sidebar data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-200 data-[state=open]:duration-300 inset-y-0 h-full w-3/4 sm:max-w-xs", side === "left" ? "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left left-0 border-r" : "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right right-0 border-l", className)} {...props}>
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 cursor-pointer"><XIcon className="size-4" /><span className="sr-only">Close</span></SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
const SheetTitle = SheetPrimitive.Title;
export { Sheet, SheetContent, SheetTitle };
