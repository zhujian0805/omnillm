// Single Apple design, dark/light switchable via data-theme attribute.
// The actual switching logic lives in App.tsx; this is just for the pre-render call in main.tsx.

export function applyTheme(): void {
  try {
    const saved = localStorage.getItem("olp-theme")
    if (saved === "light") document.documentElement.dataset.theme = "light"
    else delete document.documentElement.dataset.theme
  } catch {
    /* ignore */
  }
}
