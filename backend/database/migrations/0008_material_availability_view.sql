-- Lectura de cantidades. No reserva inventario ni calcula impacto.
-- published: cantidad declarada del material.
-- delivered: suma de entregas con estado delivered.
-- committed: saldo pendiente de solicitudes accepted o partially_fulfilled.
-- available: published - delivered - committed. Puede ser negativo si hay sobrecompromiso.

CREATE SQL SECURITY INVOKER VIEW material_quantity_summary AS
SELECT
  m.id AS material_id,
  m.unit_id,
  m.quantity AS published_quantity,
  COALESCE(delivered.total_delivered, 0) AS delivered_quantity,
  COALESCE(committed.total_committed, 0) AS committed_quantity,
  m.quantity - COALESCE(delivered.total_delivered, 0) - COALESCE(committed.total_committed, 0) AS available_quantity
FROM materials m
LEFT JOIN (
  SELECT r.material_id, SUM(d.delivered_quantity) AS total_delivered
  FROM deliveries d
  INNER JOIN material_requests r ON r.id = d.request_id
  WHERE d.status = 'delivered'
  GROUP BY r.material_id
) delivered ON delivered.material_id = m.id
LEFT JOIN (
  SELECT
    r.material_id,
    SUM(GREATEST(r.requested_quantity - COALESCE(done.total_delivered, 0), 0)) AS total_committed
  FROM material_requests r
  LEFT JOIN (
    SELECT request_id, SUM(delivered_quantity) AS total_delivered
    FROM deliveries
    WHERE status = 'delivered'
    GROUP BY request_id
  ) done ON done.request_id = r.id
  WHERE r.status IN ('accepted', 'partially_fulfilled')
  GROUP BY r.material_id
) committed ON committed.material_id = m.id;
