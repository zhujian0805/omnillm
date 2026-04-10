import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        green: "bg-gruvbox-green/20 text-gruvbox-green-accent",
        red: "bg-gruvbox-red/20 text-gruvbox-red-accent",
        yellow: "bg-gruvbox-yellow/20 text-gruvbox-yellow-accent",
        blue: "bg-gruvbox-blue/20 text-gruvbox-blue-accent",
      },
    },
    defaultVariants: { variant: "blue" },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
