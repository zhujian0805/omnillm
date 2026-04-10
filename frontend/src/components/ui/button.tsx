import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-gruvbox-blue text-gruvbox-bg-darkest hover:bg-gruvbox-blue-accent",
        secondary:
          "bg-gruvbox-bg-light-2 text-gruvbox-fg-medium hover:bg-gruvbox-bg-light-3",
        destructive: "bg-gruvbox-red text-gruvbox-fg-lightest hover:opacity-90",
        ghost: "hover:bg-gruvbox-bg-light-1 text-gruvbox-fg-medium",
      },
      size: {
        default: "h-8 px-3.5 py-1.5 text-xs",
        sm: "h-7 px-2.5 text-xs",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
