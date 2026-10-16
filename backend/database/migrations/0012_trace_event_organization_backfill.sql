-- Recupera la organización de eventos históricos que quedaron sin ella.
-- Ocurre si la columna se recrea y los eventos ya existían.
-- No borra eventos ni materiales.

UPDATE material_trace_events AS event
INNER JOIN materials AS material ON material.id = event.material_id
SET event.organization_id = material.organization_id
WHERE event.organization_id IS NULL
  AND event.operation_key LIKE 'backfill-%';
