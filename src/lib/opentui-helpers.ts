import type { ModelOption } from "./model-selection"

interface SelectRenderableClass {
  new (options: {
    initialValue: string
    items: Array<{ label: string; value: string }>
    onSubmit: (value: unknown) => void
  }): unknown
}

interface RenderFunction {
  (component: unknown): Promise<void>
}

/**
 * Filtered select using opentui SelectRenderable
 * SelectRenderable provides built-in type-to-filter search capability
 */
export async function openttuiFilteredSelect(
  models: Array<ModelOption>,
  _prompt: string,
): Promise<string> {
  // Lazy load to avoid bundler processing opentui assets

  const opentui = (await import("@opentui/core")) as {
    SelectRenderable: SelectRenderableClass
  }

  const opentuiReact = (await import("@opentui/react")) as {
    render: RenderFunction
  }

  const SelectRenderableImpl = opentui.SelectRenderable
  const renderImpl = opentuiReact.render

  let selectedModel: string | null = null

  const selectBox = new SelectRenderableImpl({
    initialValue: models[0].id,
    items: models.map((m) => ({
      label: m.id,
      value: m.id,
    })),
    onSubmit: (value: unknown) => {
      selectedModel = value as string
    },
  })

  await renderImpl(selectBox)

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return selectedModel || models[0].id
}
