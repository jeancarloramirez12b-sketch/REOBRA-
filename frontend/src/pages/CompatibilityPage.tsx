import { Badge } from '../components/ui/Badge.tsx'
import { ButtonLink } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import styles from './screen.module.css'

export function CompatibilityPage() {
  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Fase 8" title="Matching de materiales">
        <p>
          La comparación se calcula desde una necesidad abierta. Abre un proyecto, elige la necesidad y usa
          «Buscar materiales compatibles». La puntuación no certifica el material ni reserva inventario.
        </p>
      </PageHeader>

      <div className={styles.board} aria-label="Comparación prevista">
        <article className={styles.field}>
          <span>Material</span>
          <strong>Sin selección</strong>
          <small>Cantidad, unidad, lugar y estado de validación.</small>
        </article>
        <article className={styles.field}>
          <span>Necesidad</span>
          <strong>Sin selección</strong>
          <small>Proyecto, categoría, cantidad y condición pedida.</small>
        </article>
        <article className={styles.field}>
          <span>Evaluación</span>
          <Badge tone="info">reobra-match-v1</Badge>
          <small>La explicación sale de los factores calculados con datos de MySQL.</small>
        </article>
      </div>

      <ButtonLink to="/proyectos" variant="primary">Ir a proyectos</ButtonLink>
      <EmptyState icon="alert" title="La validación técnica sigue siendo independiente">
        <p>
          Aunque un material y una necesidad parezcan cercanos, REOBRA no debe tratarlos como aptos para un uso
          estructural o seguro sin una evaluación registrada.
        </p>
      </EmptyState>
    </div>
  )
}
