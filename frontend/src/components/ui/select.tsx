import * as React from "react"

import { cn } from "@/lib/utils"

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "w-full bg-gruvbox-bg-darkest border border-gruvbox-bg-light-3 text-gruvbox-fg-medium px-2.5 py-1.5 text-sm",
      "focus:outline-none focus:border-gruvbox-blue",
      "[&>option]:bg-gruvbox-bg",
      className,
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = "Select"

export { Select }
