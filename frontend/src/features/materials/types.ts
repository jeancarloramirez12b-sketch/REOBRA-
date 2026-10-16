export type MaterialImageRef = {
  id: number
  imageOrder: number
}

export type MaterialRecord = {
  id: number
  code: string
  organizationId: number
  organizationName: string
  categoryId: number
  categoryName: string
  unitId: number
  unitCode: string
  unitName: string
  title: string
  description: string | null
  materialCondition: string
  quantity: string
  originType: string
  city: string
  department: string
  locationDescription: string | null
  availabilityStatus: string
  technicalValidationStatus: string
  availableFrom: string | null
  publishedQuantity: string
  deliveredQuantity: string
  committedQuantity: string
  availableQuantity: string
  primaryImageId: number | null
  canEdit: boolean
  createdAt: string
  updatedAt: string
  images?: MaterialImageRef[]
}

export type MaterialList = {
  materials: MaterialRecord[]
  page: number
  pageSize: number
  total: number
}

export type CategoryOption = {
  id: number
  name: string
  description: string | null
}

export type UnitOption = {
  id: number
  code: string
  name: string
  dimension: string
}
