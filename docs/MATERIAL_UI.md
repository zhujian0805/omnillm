# Material UI Integration

This project now includes [Material-UI (MUI)](https://mui.com/) components alongside the existing React + TailwindCSS setup, providing beautiful Material Design components.

## What's Added

### 🎨 **Material Design Components**
- Buttons, Cards, Forms, Dialogs, Alerts, and more
- Beautiful animations and transitions
- Consistent spacing and typography
- Icons from Material Icons library

### 🌗 **Theme Integration**
- Automatic dark/light theme switching
- Matches your existing theme colors (`--color-blue`, `--color-green`)
- Consistent with your Apple-inspired design system

### 📱 **Components Available**

#### Core Components
- `Button` - Material Design buttons with variants (contained, outlined, text)
- `Card` - Elevated content cards with shadows
- `TextField` - Beautiful form inputs with floating labels
- `Switch` - Material Design toggle switches
- `Alert` - Colored alert messages
- `Dialog` - Modal dialogs with backdrop
- `Fab` - Floating Action Buttons
- `Typography` - Consistent text styling

#### Layout Components
- `Container` - Responsive container with max-width
- `Grid` - Flexible grid layout system
- `Box` - Flexible container with sx prop
- `Paper` - Material surface with elevation

## Usage Examples

### Basic Button
```tsx
import { Button } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';

<Button variant="contained" color="primary" startIcon={<SaveIcon />}>
  Save Changes
</Button>
```

### Form with Material Design
```tsx
import { TextField, Switch, FormControlLabel } from '@mui/material';

<TextField
  label="Enter your name"
  variant="outlined"
  fullWidth
/>

<FormControlLabel
  control={<Switch />}
  label="Enable notifications"
/>
```

### Cards and Layout
```tsx
import { Card, CardContent, Typography, Grid } from '@mui/material';

<Grid container spacing={3}>
  <Grid item xs={12} md={6}>
    <Card>
      <CardContent>
        <Typography variant="h5">Card Title</Typography>
        <Typography variant="body2">Card description</Typography>
      </CardContent>
    </Card>
  </Grid>
</Grid>
```

## Theme System

### Colors
The MUI theme is configured to match your existing color palette:
- **Primary**: `#0A84FF` (your blue)
- **Secondary**: `#34C759` (your green)
- **Background**: Matches your dark/light theme system
- **Text**: Uses your existing text colors

### Dark/Light Mode
The MUI theme automatically switches with your existing theme toggle. The `MuiThemeWrapper` component handles this integration.

## File Structure

```
frontend/src/
├── lib/
│   ├── mui-theme.ts          # MUI theme configuration
│   └── themes.ts             # Existing theme system
├── components/
│   ├── MuiThemeWrapper.tsx   # MUI theme provider
│   └── MaterialExampleCard.tsx # Example MUI component
└── pages/
    └── MaterialDemoPage.tsx  # Demo page showcasing MUI components
```

## Best Practices

### 1. **Mixing with Existing Components**
You can use MUI components alongside your existing Radix UI components:

```tsx
// Your existing Radix UI
import { Button as RadixButton } from '@/components/ui/button';

// New MUI components  
import { Button as MuiButton } from '@mui/material';

// Use both in the same component
<div>
  <RadixButton>Existing Style</RadixButton>
  <MuiButton variant="contained">Material Style</MuiButton>
</div>
```

### 2. **Consistent Styling**
Use the `sx` prop for custom styling that respects the theme:

```tsx
<Button sx={{ 
  borderRadius: 2, 
  fontWeight: 600,
  textTransform: 'none' // Matches your existing button style
}}>
  Custom Styled Button
</Button>
```

### 3. **Icons**
Use Material Icons for consistent iconography:

```tsx
import { Settings, Save, Delete } from '@mui/icons-material';

<Button startIcon={<Settings />}>Settings</Button>
<Button startIcon={<Save />}>Save</Button>
<Button startIcon={<Delete />}>Delete</Button>
```

## Try It Out

1. **Run the development server**:
   ```bash
   bun run dev:frontend
   ```

2. **Navigate to the Material tab** in your application to see all the beautiful Material Design components in action!

3. **Test theme switching** - The Material components will automatically adapt to your dark/light theme toggle.

## Benefits

- ✨ **Beautiful Design**: Material Design 3 components with smooth animations
- 🎯 **Consistent UX**: Follows Google's Material Design guidelines
- 🔧 **Easy Integration**: Works alongside your existing components
- 📱 **Responsive**: All components work great on mobile and desktop
- 🌗 **Theme Aware**: Automatically matches your dark/light theme
- 🚀 **Production Ready**: Battle-tested components used by thousands of apps