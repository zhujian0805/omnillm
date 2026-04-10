import consola from "consola"

import { openttuiFilteredSelect } from "./opentui-helpers"

export interface ModelOption {
  id: string
  name?: string
}

/**
 * Displays an interactive model selection with dynamic filtering using opentui.
 * Models are filtered in real-time as user types in the select box.
 */
export async function selectModelWithFilter(
  models: Array<ModelOption>,
  prompt = "Select a model",
): Promise<string> {
  if (models.length === 0) {
    throw new Error("No models available")
  }

  try {
    return await openttuiFilteredSelect(models, prompt)
  } catch {
    // Fallback to consola if opentui not available
    consola.warn(
      "opentui not available, using fallback select. Install @opentui/react to enable dynamic filtering.",
    )
    return await consola.prompt(prompt, {
      type: "select",
      options: models.map((m) => m.id),
    })
  }
}
