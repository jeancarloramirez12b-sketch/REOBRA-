export type QuantityRow = {
  unitCode: string
  quantity: number
}

export type CategoryQuantity = {
  category: string
  unitCode: string
  quantity: number
}

export type IndicatorDefinition = {
  code: string
  name: string
  definition: string
  unit: string
  formula: string
  source: string
  evidenceLevel: string
  limitation: string
}

export type MassResult =
  | { status: 'not_calculable'; kilograms: null; message: string }
  | { status: 'calculated'; kilograms: number; message: string }

export type EnvironmentalResult =
  | { status: 'not_calculable'; message: string }
  | { status: 'estimated'; value: number; unit: string; evidenceLevel: string; message: string }

export type ImpactOverview = {
  scope: 'organization' | 'memberships'
  evidenceLevel: string
  limitation: string
  inventoryNote: string
  receivedByUnit: QuantityRow[]
  dispatchedByUnit: QuantityRow[]
  pendingReceiptByUnit: QuantityRow[]
  reservedByUnit: QuantityRow[]
  publishedByUnit: QuantityRow[]
  availableByUnit: QuantityRow[]
  completedOperations: number
  participatingOrganizations: number
  benefitedProjects: number
  incidents: number
  agreementFulfillmentPercent: number | null
  operationDays: number | null
  operationSample: number
  mass: MassResult
  environmental: EnvironmentalResult
  receivedByCategory: CategoryQuantity[]
  incorporation: { status: 'not_documented'; message: string }
  definitions: IndicatorDefinition[]
}

export type TimelinePoint = {
  period: string
  unitCode: string
  quantity: number
}

export type ImpactTimeline = {
  grain: 'day' | 'month' | 'year'
  points: TimelinePoint[]
  limitation: string
}

export type NeedCoverage = {
  id: number
  title: string
  unitCode: string
  requiredQuantity: number
  receivedQuantity: number
  pendingQuantity: number
  coveragePercent: number | null
}

export type ProjectImpact = {
  projectId: number
  needs: NeedCoverage[]
  limitation: string
}

export type OrganizationImpact = {
  organizationId: number
  suppliedByUnit: QuantityRow[]
  receivedByUnit: QuantityRow[]
  evidenceLevel: string
  limitation: string
}

export type Methodology = {
  id: number
  publicCode: string
  organizationId: number
  name: string
  versionLabel: string
  statement: string
  limitations: string
  status: string
  locked: boolean
}

export type ImpactFactor = {
  id: number
  publicCode: string
  organizationId: number
  methodologyId: number
  impactKind: string
  inputUnitCode: string
  outputUnit: string
  value: number
  sourceName: string
  sourceUrl: string | null
  issuerName: string
  year: number
  regionName: string
  versionLabel: string
  conditions: string
  uncertainty: string | null
  status: string
}

export type ReportItem = {
  code: string
  label: string
  section: string
  value: string
  numericValue: number | null
  unitCode: string | null
  evidenceLevel: string
  limitations: string
}

export type IssuedReport = {
  id: number
  publicCode: string
  organizationId: number
  projectId: number | null
  periodStart: string
  periodEnd: string
  issuedAt: string
}

export type ReportDetail = {
  report: IssuedReport
  items: ReportItem[]
}
