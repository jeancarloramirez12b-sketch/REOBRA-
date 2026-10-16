-- Quita solo las categorías de referencia que ningún material está usando.

DELETE c
FROM material_categories AS c
LEFT JOIN materials AS m ON m.category_id = c.id
WHERE c.parent_category_id IS NULL
  AND m.id IS NULL
  AND c.name IN (
    'Agregados',
    'Madera',
    'Metales',
    'Concreto y prefabricados',
    'Mampostería',
    'Acabados',
    'Instalaciones',
    'Otros recuperables'
  );
