# ConfigPage Refactoring Plan

## Current Problem

`frontend/src/pages/ConfigPage.tsx` is **2,400+ lines** containing:
- Multiple type definitions
- 5 different editor components
- Main page component with state management
- Utility functions (TOML parser, etc.)

This makes the file:
- ❌ Hard to navigate
- ❌ Difficult to test individual components
- ❌ Prone to merge conflicts
- ❌ Slow to load in IDEs

## Proposed Structure

```
src/pages/config/
├── index.tsx                    # Main ConfigPage component (state + routing)
├── types.ts                     # All TypeScript interfaces
├── utils/
│   ├── tomlParser.ts           # TOML parsing utilities
│   └── configHelpers.ts        # Config normalization helpers
├── components/
│   ├── ToolCard.tsx            # Individual tool card
│   ├── Section.tsx             # Collapsible section wrapper
│   ├── Field.tsx               # Form field row
│   └── editors/
│       ├── ClaudeCodeEditor.tsx
│       ├── CodexEditor.tsx
│       ├── OpenCodeEditor.tsx
│       ├── AMPEditor.tsx
│       └── DroidEditor.tsx
└── hooks/
    └── useConfig.ts            # Config loading/saving logic
```

## File Breakdown

### 1. `types.ts` (~300 lines)
All TypeScript interfaces for configs:
- `ClaudeCodeSettings`
- `CodexConfig`, `CodexModelProvider`, `CodexProfile`
- `OpenCodeConfig`
- `AMPConfig`, `AMPProvider`, `AMPModel`
- `DroidConfig`, `DroidModel`
- API types: `ConfigFileEntry`, `ConfigFileContent`

### 2. `utils/tomlParser.ts` (~200 lines)
TOML parsing and serialization:
- `parseTOML()` function
- `serializeTOML()` function
- Helper types and utilities

### 3. `utils/configHelpers.ts` (~150 lines)
Config normalization:
- `normalizeOpenCodeConfig()`
- `normalizeAMPConfig()`
- `normalizeDroidConfig()`
- Error handling with fallback empty configs

### 4. `components/ToolCard.tsx` (~120 lines)
Individual tool card with:
- Props: `entry`, `isActive`, `onClick`
- Hover effects
- Badge rendering
- Responsive layout

### 5. `components/Section.tsx` (~80 lines)
Collapsible section wrapper:
- Title, icon, count
- Children content
- Expand/collapse state

### 6. `components/Field.tsx` (~40 lines)
Form field row:
- Label with fixed width
- Children (input, select, etc.)
- Consistent spacing

### 7. `components/editors/ClaudeCodeEditor.tsx` (~150 lines)
Claude Code structured editor:
- Model settings
- Environment variables
- Plugins

### 8. `components/editors/CodexEditor.tsx` (~250 lines)
Codex TOML editor:
- Global settings
- Model providers
- Profiles
- Projects

### 9. `components/editors/OpenCodeEditor.tsx` (~180 lines)
OpenCode JSON editor:
- Provider, model, endpoint
- Features toggles
- Skills paths
- MCP servers

### 10. `components/editors/AMPEditor.tsx` (~280 lines)
AMP configuration editor:
- Default model
- Providers
- Custom models with capabilities
- UI settings
- Logging

### 11. `components/editors/DroidEditor.tsx` (~300 lines)
Droid configuration editor:
- Custom models with parameters
- Providers
- Features
- UI settings
- Plugins

### 12. `hooks/useConfig.ts` (~200 lines)
Config management hook:
- `loadConfig(name)` - fetch and normalize
- `saveConfig(name, content)` - save and reload
- `resetConfig()` - revert to original
- State: `configs`, `activeConfig`, `rawContent`, etc.
- Handlers: `handleSave`, `handleReset`, `handleCardClick`

### 13. `index.tsx` (~300 lines)
Main ConfigPage component:
- Uses `useConfig` hook
- Renders tool cards grid
- Conditional editor rendering
- View mode toggle (structured/raw)
- Save/reset buttons

## Benefits

✅ **Maintainability**: Each file < 300 lines, easy to understand
✅ **Testability**: Can unit test individual editors and utilities
✅ **Reusability**: Shared components (Section, Field) reduce duplication
✅ **Performance**: Faster IDE autocomplete, better tree-shaking
✅ **Collaboration**: Multiple devs can work on different editors without conflicts
✅ **Extensibility**: Adding new config types is trivial (just add new editor file)

## Migration Strategy

1. ✅ Create directory structure
2. ✅ Extract types to `types.ts`
3. ✅ Extract utilities to `utils/`
4. ✅ Extract shared components (`Section`, `Field`)
5. ✅ Extract each editor to separate files
6. ✅ Create `useConfig` hook
7. ✅ Update main `index.tsx` to use refactored modules
8. ✅ Test thoroughly
9. ✅ Remove old monolithic file

## Estimated Effort

- **Time**: ~2-3 hours
- **Risk**: Low (pure refactoring, no behavior changes)
- **Testing**: Existing functionality unchanged, just file reorganization
