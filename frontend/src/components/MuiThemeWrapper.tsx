import { CssBaseline, ThemeProvider } from "@mui/material"
import { ReactNode } from "react"

import { getMuiTheme } from "@/lib/mui-theme"

interface MuiThemeWrapperProps {
  children: ReactNode
  isDark: boolean
}

export function MuiThemeWrapper({ children, isDark }: MuiThemeWrapperProps) {
  const theme = getMuiTheme(isDark)

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  )
}
