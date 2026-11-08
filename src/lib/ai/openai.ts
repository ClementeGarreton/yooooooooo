const OPENAI_API_URL = 'https://api.openai.com/v1/responses'

interface StructuredResponseOptions {
  instructions: string
  input: unknown
  schemaName: string
  schema: Record<string, unknown>
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxOutputTokens?: number
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  model: string
}

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text
  }

  const pieces: string[] = []
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content?.text === 'string') {
        pieces.push(content.text)
      }
    }
  }
  return pieces.join('\n').trim()
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const overrideInput = Number(process.env.OPENAI_INPUT_COST_PER_MILLION || '')
  const overrideOutput = Number(process.env.OPENAI_OUTPUT_COST_PER_MILLION || '')

  let inputRate = Number.isFinite(overrideInput) && overrideInput >= 0 ? overrideInput : 0
  let outputRate = Number.isFinite(overrideOutput) && overrideOutput >= 0 ? overrideOutput : 0

  if (!(inputRate || outputRate)) {
    // Tarifas estándar por millón de tokens, sin descuento por caché.
    // Los tokens de razonamiento están incluidos en output_tokens.
    if (model === 'gpt-6.1-terra') {
      inputRate = 1
      outputRate = 5
    } else if (model === 'gpt-6-luna') {
      inputRate = 0.1
      outputRate = 0.5
    } else if (model === 'gpt-5.6-luna') {
      inputRate = 0.2
      outputRate = 1.2
    } else if (model === 'gpt-5.6-terra') {
      inputRate = 2
      outputRate = 12
    } else if (model === 'gpt-6.1-sol') {
      inputRate = 2
      outputRate = 10
    }
  }

  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate
}

async function requestStructuredResponse<T>({
  instructions,
  input,
  schemaName,
  schema,
  reasoningEffort = 'medium',
  maxOutputTokens = 1200,
}: StructuredResponseOptions): Promise<{ data: T; usage: AiUsage }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no está configurada')
  }

  const model = process.env.OPENAI_MODEL || 'gpt-6.1-terra'
  // Permite subir a high desde Vercel sin modificar código, si las pruebas lo justifican.
  const configuredEffort = process.env.OPENAI_REASONING_EFFORT
  const allowedEfforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
  const effectiveEffort = allowedEfforts.some((value) => value === configuredEffort)
    ? configuredEffort
    : reasoningEffort
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: effectiveEffort },
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI respondió ${response.status}`
    throw new Error(message)
  }

  // Con esquemas estrictos, una respuesta truncada puede llegar como HTTP 200.
  // Detectarla antes del JSON.parse permite identificar el fallo en Vercel.
  if (payload?.status === 'incomplete') {
    throw new Error(`OpenAI devolvió una respuesta incompleta: ${payload?.incomplete_details?.reason || 'motivo desconocido'}`)
  }
  const text = extractOutputText(payload)
  if (!text) throw new Error('El modelo no devolvió contenido estructurado')

  const inputTokens = Number(payload?.usage?.input_tokens || 0)
  const outputTokens = Number(payload?.usage?.output_tokens || 0)
  const usage: AiUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    model,
  }

  return { data: JSON.parse(text) as T, usage }
}

export async function createStructuredResponse<T>(options: StructuredResponseOptions): Promise<T> {
  return (await requestStructuredResponse<T>(options)).data
}

export async function createStructuredResponseWithUsage<T>(
  options: StructuredResponseOptions
): Promise<{ data: T; usage: AiUsage }> {
  return requestStructuredResponse<T>(options)
}
