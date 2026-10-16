import assert from 'node:assert/strict'
import test from 'node:test'
import { canWriteMaterials, formatQuantity, inventoryEmptyKind, materialCode, validateMaterialDraft, type MaterialDraft } from './rules.ts'

function draft(overrides: Partial<MaterialDraft> = {}): MaterialDraft {
  return {
    title: 'Bloque de concreto',
    description: 'Recuperado de una losa',
    categoryId: '3',
    organizationId: '8',
    quantity: '12.5',
    unitId: '2',
    materialCondition: 'good',
    originType: 'construction',
    city: 'Medellín',
    department: 'Antioquia',
    locationDescription: 'Patio general',
    availabilityStatus: 'draft',
    availableFrom: '',
    ...overrides,
  }
}

test('el formulario exige nombre, cantidad positiva, unidad, categoría y organización', () => {
  assert.deepEqual(validateMaterialDraft(draft()), {})
  const invalid = validateMaterialDraft(
    draft({ title: '  ', quantity: '0', unitId: '', categoryId: '0', organizationId: '', availableFrom: '2026-02-31' }),
  )
  assert.equal(invalid.title, 'El nombre es obligatorio.')
  assert.equal(invalid.quantity, 'La cantidad debe ser mayor que cero.')
  assert.equal(invalid.unitId, 'Selecciona una unidad.')
  assert.equal(invalid.categoryId, 'Selecciona una categoría.')
  assert.equal(invalid.organizationId, 'Selecciona una organización.')
  assert.equal(invalid.availableFrom, 'La fecha de disponibilidad no es válida.')
  assert.ok(validateMaterialDraft(draft({ quantity: '-4' })).quantity)
})

test('el listado distingue organización, vacío, filtro sin resultados y registros', () => {
  assert.equal(inventoryEmptyKind({ hasMembership: false, total: 0, filtering: false }), 'no-organization')
  assert.equal(inventoryEmptyKind({ hasMembership: true, total: 0, filtering: false }), 'no-materials')
  assert.equal(inventoryEmptyKind({ hasMembership: true, total: 0, filtering: true }), 'no-results')
  assert.equal(inventoryEmptyKind({ hasMembership: true, total: 2, filtering: true }), 'list')
})

test('el código visible y la cantidad se muestran sin inventar decimales', () => {
  assert.equal(materialCode(24), 'MAT-000024')
  assert.equal(formatQuantity('10.000'), '10')
  assert.equal(formatQuantity('4.500'), '4.5')
  assert.equal(formatQuantity('-1.250'), '-1.25')
})

test('solo responsable, administración y edición pueden registrar materiales', () => {
  assert.equal(canWriteMaterials('owner'), true)
  assert.equal(canWriteMaterials('administrator'), true)
  assert.equal(canWriteMaterials('editor'), true)
  assert.equal(canWriteMaterials('technical_reviewer'), false)
  assert.equal(canWriteMaterials('viewer'), false)
})
