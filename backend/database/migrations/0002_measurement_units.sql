-- Catálogo de unidades. Es dato de referencia, no un inventario de demostración.

CREATE TABLE measurement_units (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(16) NOT NULL,
  name VARCHAR(80) NOT NULL,
  dimension VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_measurement_units_code (code),
  CONSTRAINT ck_measurement_units_code CHECK (code REGEXP '^[A-Za-z0-9]{1,16}$'),
  CONSTRAINT ck_measurement_units_dimension CHECK (dimension IN ('mass', 'length', 'area', 'volume', 'count'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO measurement_units (code, name, dimension) VALUES
  ('kg', 'Kilogramo', 'mass'),
  ('t', 'Tonelada', 'mass'),
  ('m', 'Metro', 'length'),
  ('m2', 'Metro cuadrado', 'area'),
  ('m3', 'Metro cúbico', 'volume'),
  ('L', 'Litro', 'volume'),
  ('unit', 'Unidad', 'count');
