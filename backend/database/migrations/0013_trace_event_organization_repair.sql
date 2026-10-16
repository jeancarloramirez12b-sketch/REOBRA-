-- Asocia la organización a eventos que perdieron esa columna al recrearla.
-- Esos registros conservan el material, así que la organización se toma de ahí.
-- No borra eventos.

UPDATE material_trace_events AS event
INNER JOIN materials AS material ON material.id = event.material_id
SET event.organization_id = material.organization_id
WHERE event.organization_id IS NULL
  AND material.organization_id IS NOT NULL;
