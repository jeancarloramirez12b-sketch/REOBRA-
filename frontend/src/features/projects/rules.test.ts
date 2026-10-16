import assert from 'node:assert/strict'
import test from 'node:test'
import { validateNeedDraft, validateProjectDraft, type NeedDraft, type ProjectDraft } from './rules.ts'

const project: ProjectDraft = {
  title: 'Remodelación',
  description: '',
  projectType: 'construction',
  organizationId: '1',
  city: 'Medellín',
  department: 'Antioquia',
  address: '',
  startDate: '2026-11-01',
  endDate: '2026-12-20',
  visibility: 'private',
  responsibleUserId: '',
  status: 'draft',
}

const need: NeedDraft = {
  title: 'Ladrillos',
  description: 'Piezas recuperadas',
  categoryId: '1',
  unitId: '1',
  requiredQuantity: '500',
  requiredCondition: 'good',
  priority: 'high',
  neededBy: '2026-12-15',
  city: '',
  department: '',
  locationDescription: '',
  observations: '',
  specificationName: '',
  specificationValue: '',
  visibility: 'private',
  status: 'open',
}

test('el proyecto exige nombre, lugar y fechas ordenadas', () => {
  assert.deepEqual(validateProjectDraft(project), {})
  assert.equal(validateProjectDraft({ ...project, title: ' ' }).title, 'El nombre es obligatorio.')
  assert.equal(
    validateProjectDraft({ ...project, startDate: '2026-12-20', endDate: '2026-11-01' }).endDate,
    'La finalización no puede ser anterior al inicio.',
  )
  assert.ok(validateProjectDraft({ ...project, visibility: 'public', status: 'draft' }).visibility)
})

test('la necesidad exige cantidad positiva y un requisito completo', () => {
  assert.deepEqual(validateNeedDraft(need), {})
  assert.ok(validateNeedDraft({ ...need, requiredQuantity: '0' }).requiredQuantity)
  assert.ok(validateNeedDraft({ ...need, requiredQuantity: '-2' }).requiredQuantity)
  assert.ok(validateNeedDraft({ ...need, specificationName: 'aparejo' }).specificationValue)
})
