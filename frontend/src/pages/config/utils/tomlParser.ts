import type { CodexConfig } from '../types'

// ─── Minimal TOML parser ─────────────────────────────────────────────────────

export function parseTOML(text: string): CodexConfig {
  const result: CodexConfig = {}
  let currentSection: string | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Sub-section like [profiles.xxx.windows] — skip subsections
    const multiDotMatch = line.match(
      /^\[([^\]][^.\]]*\.[^\]][^.\]]*\.[^\]]+)\]$/,
    )
    if (multiDotMatch) {
      currentSection = '__skip__'
      continue
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      const raw = sectionMatch[1].replaceAll(/^["']|["']$/g, '')
      currentSection = raw

      if (raw.startsWith('model_providers.')) {
        const key = raw
          .replace('model_providers.', '')
          .replaceAll(/^["']|["']$/g, '')
        if (!result.model_providers) result.model_providers = {}
        result.model_providers[key] = { name: key, base_url: '', env_key: '' }
      } else if (raw.startsWith('profiles.')) {
        const key = raw.replace('profiles.', '').replaceAll(/^["']|["']$/g, '')
        if (!result.profiles) result.profiles = {}
        result.profiles[key] = {
          name: key,
          model: '',
          model_provider: '',
          model_reasoning_effort: '',
          sandbox: '',
        }
      } else if (raw.startsWith('projects.')) {
        const key = raw.replace('projects.', '').replaceAll(/^["']|["']$/g, '')
        if (!result.projects) result.projects = {}
        result.projects[key] = { trust_level: '' }
      }
      continue
    }

    if (currentSection === '__skip__') continue

    const kvMatch = line.match(/^([\w.]+)\s*=\s*(.+)$/)
    if (!kvMatch) continue

    const key = kvMatch[1]
    const value = kvMatch[2].trim().split(' #')[0].trim()

    let parsed: string | boolean = value
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      parsed = value.slice(1, -1)
    } else if (value === 'true') {
      parsed = true
    } else if (value === 'false') {
      parsed = false
    }

    const s = String(parsed)

    if (!currentSection) {
      ;(result as Record<string, unknown>)[key] = parsed
    } else if (currentSection.startsWith('model_providers.')) {
      const name = currentSection
        .replace('model_providers.', '')
        .replaceAll(/^["']|["']$/g, '')
      if (result.model_providers?.[name])
        (result.model_providers[name] as Record<string, string>)[key] = s
    } else if (currentSection.startsWith('profiles.')) {
      const name = currentSection
        .replace('profiles.', '')
        .replaceAll(/^["']|["']$/g, '')
      if (result.profiles?.[name])
        (result.profiles[name] as Record<string, string>)[key] = s
    } else if (currentSection.startsWith('projects.')) {
      const name = currentSection
        .replace('projects.', '')
        .replaceAll(/^["']|["']$/g, '')
      if (result.projects?.[name])
        result.projects[name][key as 'trust_level'] = s
    }
  }

  return result
}

export function serializeTOML(config: CodexConfig, originalContent: string): string {
  // For TOML we do a targeted replacement strategy to preserve the original structure
  // but update the values we track in structured fields
  const lines = originalContent.split('\n')
  const result: Array<string> = []
  let currentSection = ''

  for (const line of lines) {
    const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1].replaceAll(/^["']|["']$/g, '')
      result.push(line)
      continue
    }

    const kvMatch = line.trim().match(/^([\w.]+)\s*=\s*(.+)$/)
    if (kvMatch) {
      const key = kvMatch[1]

      if (!currentSection) {
        if (key === 'model' && config.model !== undefined) {
          result.push(`${key} = "${config.model}"`)
          continue
        }
        if (
          key === 'model_reasoning_effort'
          && config.model_reasoning_effort !== undefined
        ) {
          result.push(`${key} = "${config.model_reasoning_effort}"`)
          continue
        }
        if (key === 'profile' && config.profile !== undefined) {
          result.push(`${key} = '${config.profile}'`)
          continue
        }
      } else if (currentSection.startsWith('model_providers.')) {
        const name = currentSection
          .replace('model_providers.', '')
          .replaceAll(/^["']|["']$/g, '')
        const provider = config.model_providers?.[name]
        if (provider) {
          if (key === 'base_url') {
            result.push(`base_url = "${provider.base_url}"`)
            continue
          }
          if (key === 'env_key') {
            result.push(`env_key = "${provider.env_key}"`)
            continue
          }
          if (key === 'name') {
            result.push(`name = "${provider.name}"`)
            continue
          }
        }
      } else if (currentSection.startsWith('profiles.')) {
        const name = currentSection
          .replace('profiles.', '')
          .replaceAll(/^["']|["']$/g, '')
        const profile = config.profiles?.[name]
        if (profile) {
          if (key === 'model') {
            result.push(`model = "${profile.model}"`)
            continue
          }
          if (key === 'model_provider') {
            result.push(`model_provider = "${profile.model_provider}"`)
            continue
          }
          if (key === 'model_reasoning_effort') {
            result.push(
              `model_reasoning_effort = "${profile.model_reasoning_effort}"`,
            )
            continue
          }
          if (key === 'sandbox') {
            result.push(`sandbox = "${profile.sandbox}"`)
            continue
          }
        }
      } else if (currentSection.startsWith('projects.')) {
        const name = currentSection
          .replace('projects.', '')
          .replaceAll(/^["']|["']$/g, '')
        const project = config.projects?.[name]
        if (project && key === 'trust_level') {
          result.push(`trust_level = "${project.trust_level}"`)
          continue
        }
      }
    }

    result.push(line)
  }

  return result.join('\n')
}
