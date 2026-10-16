export type MatchNarrativeInput = {
  title: string
  availableQuantity: number
  requiredQuantity: number
  unitName: string
  coveragePercent: number | null
  observedScore: number | null
  classification: string
  explanation: string
  hardPass: boolean
  technicalValidationStatus: string
}

export type ImpactQuantity = { unitCode: string; quantity: number }

export type ImpactNarrativeInput = {
  receivedByUnit: ImpactQuantity[]
  massStatus: string
  massMessage: string
  environmentalStatus: string
  environmentalMessage: string
  indicator: {
    code: string
    name: string
    definition: string
    unit: string
    formula: string
    limitation: string
  } | null
}

const numberFormat = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function narrateMatch(input: MatchNarrativeInput): { source: 'matching_engine'; narrative: string; coversAll: boolean } {
  const coversAll = input.hardPass && input.coveragePercent !== null && input.coveragePercent >= 99.995
  const coverage = input.coveragePercent === null ? 'no calculada' : `${numberFormat.format(input.coveragePercent)} %`
  const score = input.observedScore === null ? 'no calculado' : numberFormat.format(input.observedScore)
  const coverageSentence = coversAll
    ? 'La cantidad disponible alcanza la cantidad requerida.'
    : `La cantidad disponible (${numberFormat.format(input.availableQuantity)} ${input.unitName}) no cubre toda la necesidad (${numberFormat.format(input.requiredQuantity)} ${input.unitName}).`
  const narrative = [
    'Esta explicación usa el resultado del motor de matching. No modifica la compatibilidad, la cobertura ni el puntaje.',
    input.explanation,
    `Puntaje observado: ${score}. Cobertura de cantidad: ${coverage}. La cobertura no es el puntaje.`,
    input.hardPass ? coverageSentence : 'El material no supera un requisito obligatorio. No se presenta como técnicamente seguro.',
    `Estado de revisión técnica registrado: ${input.technicalValidationStatus}. Esta explicación no certifica el material ni lo declara apto para la obra.`,
  ].join(' ')
  return { source: 'matching_engine', narrative, coversAll }
}

export function narrateImpact(input: ImpactNarrativeInput): { source: 'impact_engine'; narrative: string } {
  const received = input.receivedByUnit.length === 0
    ? 'No hay cantidad recibida y confirmada en el período consultado.'
    : `Recibido y confirmado: ${input.receivedByUnit.map((item) => `${numberFormat.format(item.quantity)} ${item.unitCode}`).join(', ')}.`
  const mass = input.massStatus === 'calculated'
    ? `Masa informada por el motor: ${input.massMessage}`
    : `${input.massMessage || 'Masa no calculable con los datos actuales.'} No se convierten las unidades a kilogramos sin un parámetro de masa.`
  const environmental = input.environmentalStatus === 'estimated'
    ? `El motor registró una estimación: ${input.environmentalMessage} No es una certificación ambiental.`
    : `${input.environmentalMessage || 'No calculable: faltan datos o factores validados.'} No se inventan emisiones evitadas.`
  const indicator = input.indicator
    ? `${input.indicator.name}: ${input.indicator.definition} Fórmula: ${input.indicator.formula} Unidad: ${input.indicator.unit} Limitación: ${input.indicator.limitation}`
    : 'Los indicadores muestran lo que el motor de impacto calculó con los datos disponibles.'
  return {
    source: 'impact_engine',
    narrative: [received, mass, environmental, indicator, 'Una recepción confirmada no demuestra instalación ni un ahorro de emisiones.'].join(' '),
  }
}
