import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn("bg-muted inline-flex w-fit items-center rounded-lg p-[3px]", className)} {...props} />;
}
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={cn("text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none cursor-pointer", className)} {...props} />;
}
export { ToggleGroup, ToggleGroupItem };
