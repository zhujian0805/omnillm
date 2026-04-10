import { createTheme, ThemeOptions } from "@mui/material/styles"

// Material Design 3 colors that match your existing theme
const lightTheme: ThemeOptions = {
  palette: {
    mode: "light",
    primary: {
      main: "#0A84FF", // Your existing blue
      light: "#5BA7FF",
      dark: "#0066CC",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#34C759", // Your existing green
      light: "#62D87A",
      dark: "#28A745",
      contrastText: "#ffffff",
    },
    background: {
      default: "#F2F2F7", // iOS light background
      paper: "#FFFFFF",
    },
    text: {
      primary: "#000000",
      secondary: "#6D6D80",
    },
    divider: "#C6C6C8",
  },
  shape: {
    borderRadius: 8, // Matches your --radius-md
  },
  typography: {
    fontFamily: [
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "Helvetica Neue",
      "Arial",
      "sans-serif",
    ].join(","),
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 8,
          fontWeight: 600,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow:
            "0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)",
        },
      },
    },
  },
}

const darkTheme: ThemeOptions = {
  palette: {
    mode: "dark",
    primary: {
      main: "#0A84FF",
      light: "#5BA7FF",
      dark: "#0066CC",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#34C759",
      light: "#62D87A",
      dark: "#28A745",
      contrastText: "#ffffff",
    },
    background: {
      default: "#000000", // Your existing dark background
      paper: "#1C1C1E",
    },
    text: {
      primary: "#FFFFFF",
      secondary: "#8E8E93",
    },
    divider: "#38383A",
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: [
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "Helvetica Neue",
      "Arial",
      "sans-serif",
    ].join(","),
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 8,
          fontWeight: 600,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: "#1C1C1E",
          boxShadow:
            "0 1px 3px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.3)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: "#1C1C1E",
        },
      },
    },
  },
}

export const lightMuiTheme = createTheme(lightTheme)
export const darkMuiTheme = createTheme(darkTheme)

export function getMuiTheme(isDark: boolean) {
  return isDark ? darkMuiTheme : lightMuiTheme
}
