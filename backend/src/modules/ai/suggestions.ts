const inventedTerms = ['resistencia', 'certificacion', 'certificación', 'certificado', 'norma', 'ntc', 'mpa', 'kgco2', 'co2e']

export type CategoryOption = { id: number; name: string; description: string | null }

export type MaterialSuggestionInput = {
  title: string
  description: string
  quantity: string
  unitName: string
  condition: string
  city: string
  department: string
  availabilityStatus: string
  hasEvidence: boolean
  restrictions: string
}

export type MaterialSuggestion = {
  source: 'rules'
  description: string
  category: { id: number; name: string; reason: string } | null
  missing: string[]
  warnings: string[]
  tags: string[]
  disclaimer: string
}

export type ProjectSuggestionInput = {
  title: string
  description: string
  quantity: string
  unitName: string
  categoryName: string
  condition: string
  specificationName: string
  specificationValue: string
}

export type ProjectSuggestion = {
  source: 'rules'
  draft: string
  missing: string[]
  ambiguities: string[]
  unitNote: string
  disclaimer: string
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function tokens(value: string): string[] {
  return fold(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 4)
}

function containsInvented(output: string, source: string): boolean {
  const foldedOutput = fold(output)
  const foldedSource = fold(source)
  return inventedTerms.some((term) => foldedOutput.includes(fold(term)) && !foldedSource.includes(fold(term)))
}

export function suggestCategory(text: string, categories: CategoryOption[]): MaterialSuggestion['category'] {
  const userTokens = tokens(text)
  let best: { category: CategoryOption; score: number } | null = null
  for (const category of categories) {
    if (fold(category.name) === 'otros recuperables') continue
    const catalogTokens = tokens(`${category.name} ${category.description ?? ''}`)
    let score = 0
    for (const left of userTokens) {
      for (const right of catalogTokens) {
        if (left.startsWith(right) || right.startsWith(left)) score += right.length >= 6 ? 2 : 1
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { category, score }
  }
  if (!best) return null
  return {
    id: best.category.id,
    name: best.category.name,
    reason: `La categoría ${best.category.name} ya existe en el catálogo y coincide con palabras del texto. Hay que aceptarla; no se asigna sola.`,
  }
}

export function quantityMismatch(description: string, quantity: string): string | null {
  const match = description.match(/(\d+(?:[.,]\d+)?)\s*unidades?/i)
  if (!match?.[1] || !quantity.trim()) return null
  const described = Number(match[1].replace(',', '.'))
  const declared = Number(quantity.replace(',', '.'))
  if (!Number.isFinite(described) || !Number.isFinite(declared) || described === declared) return null
  return `La descripción menciona ${described} unidades y el formulario registra ${declared}. Revisa cuál es la cantidad correcta. No se modificó ningún dato.`
}

function text(value: string | undefined): string {
  return value?.trim() ?? ''
}

export function buildMaterialSuggestion(input: {
  title?: string
  description?: string
  quantity?: string
  unitName?: string
  condition?: string
  city?: string
  department?: string
  availabilityStatus?: string
  hasEvidence?: boolean
  restrictions?: string
}, categories: CategoryOption[]): MaterialSuggestion {
  const title = text(input.title)
  const description = text(input.description)
  const quantity = text(input.quantity)
  const unitName = text(input.unitName)
  const conditionLabels: Record<string, string> = {
    good: 'buena',
    fair: 'aceptable',
    deteriorated: 'deteriorada',
    mixed: 'mixta',
  }
  const condition = conditionLabels[text(input.condition)] ?? ''
  const city = text(input.city)
  const department = text(input.department)
  const availabilityStatus = text(input.availabilityStatus)
  const restrictions = text(input.restrictions)
  const hasEvidence = input.hasEvidence === true
  const source = [title, description, quantity, unitName, condition, city, department, restrictions].join(' ')
  const parts = [title || description]
  if (quantity && unitName) parts.push(`Cantidad declarada: ${quantity} ${unitName}.`)
  else if (quantity) parts.push(`Cantidad declarada: ${quantity}.`)
  if (condition) parts.push(`Condición declarada: ${condition}.`)
  const place = [city, department].filter(Boolean).join(', ')
  if (place) parts.push(`Lugar declarado: ${place}.`)
  if (restrictions) parts.push(`Restricción declarada: ${restrictions}.`)
  let drafted = parts.filter(Boolean).join(' ')
  if (containsInvented(drafted, source)) drafted = title
  const missing: string[] = []
  if (!quantity) missing.push('Cantidad.')
  if (!unitName) missing.push('Unidad.')
  if (!/dimension|medida|cm|mm|metro|largo|ancho|alto/i.test(source)) missing.push('Dimensiones.')
  if (!condition) missing.push('Condición.')
  if (!city && !department) missing.push('Ubicación general.')
  if (!hasEvidence) missing.push('Evidencias.')
  if (!availabilityStatus) missing.push('Disponibilidad.')
  if (!restrictions) missing.push('Restricciones de uso.')
  const warning = quantityMismatch(description, quantity)
  const tags = [...new Set(tokens(title))].slice(0, 6).filter((tag) => !inventedTerms.some((term) => tag.includes(fold(term))))
  return {
    source: 'rules',
    description: drafted,
    category: suggestCategory(source, categories),
    missing,
    warnings: warning ? [warning] : [],
    tags,
    disclaimer: 'La sugerencia solo reúne datos ya escritos. No añade resistencia, dimensiones ni certificaciones. Aceptarla no publica ni certifica el material.',
  }
}

const ambiguousWords = ['varios', 'suficiente', 'apto', 'adecuado', 'buen estado', 'según obra']

export function buildProjectSuggestion(input: {
  title?: string
  description?: string
  quantity?: string
  unitName?: string
  categoryName?: string
  condition?: string
  specificationName?: string
  specificationValue?: string
}): ProjectSuggestion {
  const title = text(input.title)
  const description = text(input.description)
  const quantity = text(input.quantity)
  const unitName = text(input.unitName)
  const categoryName = text(input.categoryName)
  const conditionLabels: Record<string, string> = {
    good: 'buena',
    fair: 'aceptable',
    deteriorated: 'deteriorada',
    mixed: 'mixta',
    not_declared: 'no declarada',
  }
  const condition = conditionLabels[text(input.condition)] ?? text(input.condition)
  const specificationName = text(input.specificationName)
  const specificationValue = text(input.specificationValue)
  const source = [title, description, quantity, unitName, categoryName, condition, specificationName, specificationValue].join(' ')
  const parts = [title]
  if (categoryName) parts.push(`Categoría: ${categoryName}.`)
  if (quantity && unitName) parts.push(`Cantidad: ${quantity} ${unitName}.`)
  if (condition) parts.push(`Condición declarada: ${condition}.`)
  if (specificationName && specificationValue) parts.push(`Requisito declarado: ${specificationName} = ${specificationValue}.`)
  const draft = parts.filter(Boolean).join(' ').slice(0, 500)
  const missing: string[] = []
  if (!quantity) missing.push('Cantidad requerida.')
  if (!unitName) missing.push('Unidad.')
  if (!categoryName) missing.push('Categoría del catálogo.')
  if (!condition) missing.push('Condición aceptable.')
  if (!specificationName || !specificationValue) missing.push('Requisito técnico con nombre y valor.')
  const folded = fold(source)
  const ambiguities = ambiguousWords.filter((word) => folded.includes(fold(word))).map((word) => `La expresión “${word}” es ambigua y no define un requisito verificable.`)
  return {
    source: 'rules',
    draft,
    missing,
    ambiguities,
    unitNote: unitName
      ? `La unidad declarada es ${unitName}. REOBRA no convierte sola entre magnitudes distintas.`
      : 'Todavía no hay unidad. Sin ella no se puede comparar cantidad.',
    disclaimer: 'Esta redacción no sustituye al responsable técnico del proyecto. Si el uso puede ser estructural, eléctrico, sanitario o de seguridad, la idoneidad requiere evaluación técnica. No se afirma cumplimiento de una norma.',
  }
}
