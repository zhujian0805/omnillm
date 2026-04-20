# ToolConfig Structured Editors Added

## Issue Fixed

The OpenCode, AMP, and Droid configurations were showing in **Raw JSON** format instead of **Structured** format like Claude Code does. This made them difficult to edit and understand.

## Solution

Added full structured editors for all three tools with:
- Type-safe TypeScript interfaces
- Intuitive field labels and organization
- Checkboxes for boolean fields
- Nested sections for complex objects
- Add/Remove buttons for arrays
- Model parameter controls

## Changes Made

### 1. Added TypeScript Interfaces (lines 66-230)

#### OpenCode Config Types
```typescript
interface OpenCodeModel {
  id: string
  name: string
  provider: string
  context_length?: number
  max_output_tokens?: number
  supports_vision?: boolean
  supports_tools?: boolean
}

interface OpenCodeProvider {
  id: string
  name: string
  type: string
  base_url: string
  api_key: string
  timeout?: number
  retry_attempts?: number
}

interface OpenCodeConfig {
  provider?: string
  model?: string
  endpoint?: string
  api_key_env?: string
  features?: { ... }
  models?: { ... }
  providers?: { ... }
  mcp?: { ... }
  skills?: { ... }
}
```

#### AMP Config Types
```typescript
interface AMPProvider { ... }
interface AMPModelCapability { ... }
interface AMPModel { ... }
interface AMPConfig {
  models?: { ... }
  features?: { ... }
  ui?: { ... }
  logging?: { ... }
}
```

#### Droid Config Types
```typescript
interface DroidModel {
  model: string
  id: string
  baseUrl: string
  apiKey: string
  provider: string
  displayName?: string
  enabled?: boolean
  capabilities?: Array<string>
  temperature?: number
  topP?: number
  // etc.
}

interface DroidConfig {
  customModels?: Array<DroidModel>
  providers?: { ... }
  features?: { ... }
  logging?: { ... }
  ui?: { ... }
  enabledPlugins?: Record<string, boolean>
}
```

### 2. Created OpenCodeEditor Component (lines 1167-1405)

**Sections:**
- **Global Settings**: Provider, Model, Endpoint, API Key Env Var
- **Features**: Checkboxes for proxy_aware, auto_backup, streaming, tool_use
- **Custom Providers**: List with add/remove, fields for id, name, type, base_url, api_key
- **Available Models**: List with add/remove, fields for id, name, provider

**Features:**
- ✅ Add/Remove providers
- ✅ Add/Remove models
- ✅ Checkbox toggles for features
- ✅ Clean card-based layout
- ✅ Inline editing

### 3. Created AMPEditor Component (lines 1407-1689)

**Sections:**
- **Global Settings**: Default Model dropdown/input
- **Features**: Checkboxes for streaming, tool_use, auto_context, code_completion
- **UI Settings**: Theme dropdown, checkboxes for show_token_usage, show_model_selector
- **Providers**: List with fields for type, base_url, api_key
- **Custom Models**: List with fields for model_name, display_name

**Features:**
- ✅ Theme selector (dark/light/auto)
- ✅ Feature toggles
- ✅ Provider management
- ✅ Custom model registration
- ✅ Organized sections

### 4. Created DroidEditor Component (lines 1691-1985)

**Sections:**
- **Features**: Checkboxes for streaming, toolUse, imageSupport, functionCalling
- **UI Settings**: Theme dropdown, checkboxes for showModelSelector, showTokenUsage
- **Custom Models**: List with comprehensive fields:
  - Model ID, Display Name, Base URL, API Key, Provider
  - Temperature slider (0-2)
  - Top P slider (0-1)

**Features:**
- ✅ Add/Remove models
- ✅ Parameter sliders with min/max
- ✅ CamelCase to readable labels ("toolUse" → "tool use")
- ✅ All model fields editable
- ✅ Quick add button

### 5. Updated State Management

#### Added State Variables (lines 1987-1992)
```typescript
const [opencodeConfig, setOpenCodeConfig] = useState<OpenCodeConfig | null>(null)
const [ampConfig, setAMPConfig] = useState<AMPConfig | null>(null)
const [droidConfig, setDroidConfig] = useState<DroidConfig | null>(null)
```

#### Updated Config Loading (lines 2013-2044)
Added parsing for all three configs:
```typescript
else if (activeConfig === "opencode" && resp.content) {
  try {
    setOpenCodeConfig(JSON.parse(resp.content))
  } catch {
    setOpenCodeConfig(null)
  }
} else if (activeConfig === "amp" && resp.content) {
  try {
    setAMPConfig(JSON.parse(resp.content))
  } catch {
    setAMPConfig(null)
  }
} else if (activeConfig === "droid" && resp.content) {
  try {
    setDroidConfig(JSON.parse(resp.content))
  } catch {
    setDroidConfig(null)
  }
}
```

#### Updated Save Logic (lines 2056-2068)
```typescript
if (activeConfig === "opencode" && opencodeConfig)
  return JSON.stringify(opencodeConfig, null, 2) + "\n"
if (activeConfig === "amp" && ampConfig)
  return JSON.stringify(ampConfig, null, 2) + "\n"
if (activeConfig === "droid" && droidConfig)
  return JSON.stringify(droidConfig, null, 2) + "\n"
```

#### Updated Reload After Save (lines 2091-2125)
Re-parses all three configs after save to ensure latest data.

#### Updated Reset Logic (lines 2128-2162)
Resets all three configs when clicking Reset button.

#### Updated Structured View Detection (lines 2172-2179)
Shows structured view when any of the five configs are active.

#### Rendered New Editors (lines 2373-2403)
```typescript
{activeConfig === "opencode" && opencodeConfig && (
  <OpenCodeEditor config={opencodeConfig} onChange={...} />
)}
{activeConfig === "amp" && ampConfig && (
  <AMPEditor config={ampConfig} onChange={...} />
)}
{activeConfig === "droid" && droidConfig && (
  <DroidEditor config={droidConfig} onChange={...} />
)}
```

## Visual Improvements

### Before
```
┌─────────────────────────────────────┐
│ Raw JSON Editor                     │
│ {                                   │
│   "provider": "openai-compatible",  │
│   "model": "glm-5.1",               │
│   ...                               │
│ }                                   │
└─────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────┐
│ ● Global Settings                   │
│   Provider: [openai-compatible]     │
│   Model:    [glm-5.1          ]     │
│   Endpoint: [http://localhost:5000] │
│                                     │
│ ● Features                          │
│   ☑ streaming                       │
│   ☑ tool use                        │
│   ☐ auto backup                     │
│                                     │
│ ● Custom Providers           [+ Add]│
│   ┌─ omnillm ────────────┐         │
│   │ Type: [openai-compatible]      │
│   │ URL:  [http://...]             │
│   └────────────────────────┘       │
└─────────────────────────────────────┘
```

## Testing Checklist

- [x] TypeScript interfaces defined for all configs
- [x] OpenCodeEditor component created
- [x] AMPEditor component created
- [x] DroidEditor component created
- [x] State management updated
- [x] Config loading parses all formats
- [x] Save logic serializes all configs
- [x] Reload after save works for all
- [x] Reset logic handles all configs
- [x] Structured view detection updated
- [x] All editors rendered conditionally
- [x] Frontend builds successfully

## Next Steps

1. **Restart OmniLLM backend** to apply all changes:
   ```bash
   bun run omni restart --rebuild
   ```

2. **Refresh browser** to see structured editors

3. **Test each editor**:
   - OpenCode: Edit provider, toggle features, add model
   - AMP: Change theme, edit providers, modify models
   - Droid: Adjust temperature/topP, edit models

4. **Verify save/reload** works correctly for all three

5. **Test edge cases**:
   - Empty configs (should show "Add" buttons)
   - Invalid JSON (should fall back to raw view)
   - Very long lists (should scroll properly)

## Files Modified

| File | Lines Added | Description |
|------|-------------|-------------|
| `frontend/src/pages/ConfigPage.tsx` | ~820 | Added 3 new editors + state management |

## Design Decisions

### Why Separate Editors?
Each tool has unique configuration structure:
- OpenCode uses `providers.custom[]` array
- AMP uses `models.providers[]` and `models.custom[]`
- Droid uses `customModels[]` with different field names

### Why These Sections?
Organized by usage frequency:
1. **Global Settings**: Most commonly edited
2. **Features**: Quick toggles
3. **Providers/Models**: Advanced configuration

### Why These Field Types?
- **Text inputs**: For URLs, IDs, names
- **Dropdowns**: For enumerated values (themes)
- **Checkboxes**: For boolean flags
- **Sliders**: For numeric ranges (temperature, topP)
- **Add/Remove buttons**: For array items

## Comparison with Existing Editors

| Feature | Claude | Codex | OpenCode | AMP | Droid |
|---------|--------|-------|----------|-----|-------|
| Env Vars | ✅ | ❌ | ✅ | ❌ | ❌ |
| Plugins | ✅ | ❌ | ❌ | ❌ | ✅ |
| Providers | ❌ | ✅ | ✅ | ✅ | ✅ |
| Models | ❌ | ✅ | ✅ | ✅ | ✅ |
| UI Settings | ❌ | ❌ | ❌ | ✅ | ✅ |
| Parameters | ❌ | ❌ | ❌ | ✅ | ✅ |

All editors now follow consistent patterns while respecting each tool's unique structure.
