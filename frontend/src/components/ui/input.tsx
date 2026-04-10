import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "w-full bg-gruvbox-bg-darkest border border-gruvbox-bg-light-3 text-gruvbox-fg-medium px-2.5 py-1.5 text-sm",
      "placeholder:text-gruvbox-gray focus:outline-none focus:border-gruvbox-blue",
      className,
    )}
    ref={ref}
    {...props}
  />
))
Input.displayName = "Input"

export { Input }
