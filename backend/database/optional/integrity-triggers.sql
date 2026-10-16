-- No forma parte de las migraciones automáticas.
-- MySQL solo permite crear estos disparadores si log_bin_trust_function_creators = ON
-- o si la cuenta tiene privilegio SUPER. La cuenta de la aplicación en este entorno no puede hacerlo.
-- Ejecútelo manualmente, con una cuenta administradora, después de las migraciones 0001 a 0008.

CREATE TRIGGER tr_material_categories_before_update
BEFORE UPDATE ON material_categories
FOR EACH ROW
BEGIN
  IF NEW.parent_category_id IS NOT NULL AND NEW.parent_category_id = NEW.id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una categoría no puede ser su propia categoría padre.';
  END IF;
END;

CREATE TRIGGER tr_material_passports_after_update
AFTER UPDATE ON material_passports
FOR EACH ROW
BEGIN
  IF OLD.version <> NEW.version
    OR NOT (OLD.origin_description <=> NEW.origin_description)
    OR NOT (CAST(OLD.specifications_json AS CHAR) <=> CAST(NEW.specifications_json AS CHAR))
  THEN
    INSERT INTO material_passport_revisions (
      passport_id,
      version,
      origin_description,
      specifications_json,
      issued_at,
      created_at
    ) VALUES (
      OLD.id,
      OLD.version,
      OLD.origin_description,
      OLD.specifications_json,
      OLD.issued_at,
      CURRENT_TIMESTAMP(3)
    );
  END IF;
END;

CREATE TRIGGER tr_deliveries_before_insert
BEFORE INSERT ON deliveries
FOR EACH ROW
BEGIN
  DECLARE requested DECIMAL(14, 3);
  DECLARE already DECIMAL(14, 3);
  IF NEW.status = 'delivered' THEN
    SELECT requested_quantity INTO requested
    FROM material_requests
    WHERE id = NEW.request_id;
    SELECT COALESCE(SUM(delivered_quantity), 0) INTO already
    FROM deliveries
    WHERE request_id = NEW.request_id
      AND status = 'delivered';
    IF requested IS NULL OR NEW.delivered_quantity IS NULL OR already + NEW.delivered_quantity > requested THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad entregada supera la cantidad solicitada.';
    END IF;
  END IF;
END;

CREATE TRIGGER tr_deliveries_before_update
BEFORE UPDATE ON deliveries
FOR EACH ROW
BEGIN
  DECLARE requested DECIMAL(14, 3);
  DECLARE already DECIMAL(14, 3);
  IF NEW.status = 'delivered' THEN
    SELECT requested_quantity INTO requested
    FROM material_requests
    WHERE id = NEW.request_id;
    SELECT COALESCE(SUM(delivered_quantity), 0) INTO already
    FROM deliveries
    WHERE request_id = NEW.request_id
      AND status = 'delivered'
      AND id <> NEW.id;
    IF requested IS NULL OR NEW.delivered_quantity IS NULL OR already + NEW.delivered_quantity > requested THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad entregada supera la cantidad solicitada.';
    END IF;
  END IF;
END;

CREATE TRIGGER tr_impact_records_before_insert
BEFORE INSERT ON impact_records
FOR EACH ROW
BEGIN
  DECLARE delivery_material BIGINT UNSIGNED;
  IF NEW.delivery_id IS NOT NULL THEN
    SELECT r.material_id INTO delivery_material
    FROM deliveries d
    INNER JOIN material_requests r ON r.id = d.request_id
    WHERE d.id = NEW.delivery_id;
    IF delivery_material IS NULL OR delivery_material <> NEW.material_id THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El impacto no corresponde al material de la entrega.';
    END IF;
  END IF;
END;

CREATE TRIGGER tr_impact_records_before_update
BEFORE UPDATE ON impact_records
FOR EACH ROW
BEGIN
  DECLARE delivery_material BIGINT UNSIGNED;
  IF NEW.delivery_id IS NOT NULL THEN
    SELECT r.material_id INTO delivery_material
    FROM deliveries d
    INNER JOIN material_requests r ON r.id = d.request_id
    WHERE d.id = NEW.delivery_id;
    IF delivery_material IS NULL OR delivery_material <> NEW.material_id THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El impacto no corresponde al material de la entrega.';
    END IF;
  END IF;
END;
