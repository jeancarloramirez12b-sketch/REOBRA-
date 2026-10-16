-- Catálogo de referencia para clasificar materiales. No inserta inventario de demostración.

INSERT INTO material_categories (name, description)
SELECT 'Agregados', 'Áridos, gravas y materiales granulares recuperables.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Agregados'
);

INSERT INTO material_categories (name, description)
SELECT 'Madera', 'Madera estructural, tableros y piezas de carpintería recuperables.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Madera'
);

INSERT INTO material_categories (name, description)
SELECT 'Metales', 'Acero, aluminio y otras piezas metálicas recuperables.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Metales'
);

INSERT INTO material_categories (name, description)
SELECT 'Concreto y prefabricados', 'Concreto, morteros y elementos prefabricados recuperables.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Concreto y prefabricados'
);

INSERT INTO material_categories (name, description)
SELECT 'Mampostería', 'Ladrillo, bloque y piezas de mampostería recuperables.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Mampostería'
);

INSERT INTO material_categories (name, description)
SELECT 'Acabados', 'Pisos, revestimientos, puertas y piezas de acabado recuperables.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Acabados'
);

INSERT INTO material_categories (name, description)
SELECT 'Instalaciones', 'Componentes de instalaciones recuperables, sin certificación de uso.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Instalaciones'
);

INSERT INTO material_categories (name, description)
SELECT 'Otros recuperables', 'Materiales que no encajan en las categorías anteriores.'
WHERE NOT EXISTS (
  SELECT 1 FROM material_categories WHERE parent_category_id IS NULL AND name = 'Otros recuperables'
);
