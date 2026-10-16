import type { SqlExecutor } from '../../utils/sql.js'

export async function markMaterialMatchesStale(executor: SqlExecutor, materialId: number): Promise<void> {
  await executor.query('UPDATE material_matches SET stale = 1 WHERE material_id = ? AND stale = 0', [materialId])
}

export async function markNeedMatchesStale(executor: SqlExecutor, needId: number): Promise<void> {
  await executor.query('UPDATE material_matches SET stale = 1 WHERE project_need_id = ? AND stale = 0', [needId])
}

export async function markProjectMatchesStale(executor: SqlExecutor, projectId: number): Promise<void> {
  await executor.query(
    `UPDATE material_matches mm
     INNER JOIN project_material_needs n ON n.id = mm.project_need_id
     SET mm.stale = 1
     WHERE n.project_id = ? AND mm.stale = 0`,
    [projectId],
  )
}
