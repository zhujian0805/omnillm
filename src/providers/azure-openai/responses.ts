interface ResponsesTextItem {
  text?: unknown
  type?: unknown
}

interface ResponsesOutputItem {
  content?: unknown
}

interface ResponsesChoice {
  message?: {
    content?: unknown
  }
}

interface ResponsesPayloadLike {
  output?: unknown
  output_text?: unknown
  choices?: Array<ResponsesChoice>
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function extractTextItems(items: unknown): Array<string> {
  if (typeof items === "string") {
    return isNonEmptyText(items) ? [items] : []
  }

  if (!Array.isArray(items)) {
    return []
  }

  const texts: Array<string> = []

  for (const item of items) {
    if (typeof item === "string") {
      if (isNonEmptyText(item)) {
        texts.push(item)
      }

      continue
    }

    if (!item || typeof item !== "object") {
      continue
    }

    const { type, text } = item as ResponsesTextItem
    if ((type === "output_text" || type === "text") && isNonEmptyText(text)) {
      texts.push(text)
    }
  }

  return texts
}

export function extractResponsesOutputTexts(
  json: ResponsesPayloadLike | null | undefined,
): Array<string> {
  if (!json) {
    return []
  }

  const directText = extractTextItems(json.output_text)
  if (directText.length > 0) {
    return directText
  }

  const outputTexts: Array<string> = []
  if (Array.isArray(json.output)) {
    for (const outputItem of json.output) {
      if (!outputItem || typeof outputItem !== "object") {
        continue
      }

      outputTexts.push(
        ...extractTextItems((outputItem as ResponsesOutputItem).content),
      )
    }
  }

  if (outputTexts.length > 0) {
    return outputTexts
  }

  const legacyTexts: Array<string> = []
  if (Array.isArray(json.choices)) {
    for (const choice of json.choices) {
      if (!choice) {
        continue
      }

      legacyTexts.push(...extractTextItems(choice.message?.content))
    }
  }

  return legacyTexts
}

export function extractResponsesOutputText(
  json: ResponsesPayloadLike | null | undefined,
): string {
  return extractResponsesOutputTexts(json).join("")
}
