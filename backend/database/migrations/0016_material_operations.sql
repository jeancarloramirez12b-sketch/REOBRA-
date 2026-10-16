-- Solicitudes, acuerdos, reservas y movimientos de la Fase 9.
-- No cambia la fórmula de material_quantity_summary:
--   disponible = cantidad declarada - entregas con estado delivered - saldo comprometido.
--   comprometido = solicitudes accepted o partially_fulfilled todavía no despachadas.
-- Solicitar o negociar no cambia esa vista. Aceptar con las dos confirmaciones pasa a accepted y reserva.
-- Un despacho con estado delivered consume la reserva. La recepción no vuelve a descontar.

ALTER TABLE material_requests
  DROP CHECK ck_material_requests_status;

ALTER TABLE material_requests
  ADD COLUMN public_code VARCHAR(32) NULL AFTER id,
  ADD COLUMN project_need_id BIGINT UNSIGNED NULL AFTER project_id,
  ADD COLUMN message VARCHAR(2000) NULL AFTER requested_quantity,
  ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL AFTER message,
  ADD COLUMN proposal_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER created_by_user_id,
  ADD COLUMN requester_confirmed_by_user_id BIGINT UNSIGNED NULL AFTER proposal_version,
  ADD COLUMN requester_confirmed_at DATETIME(3) NULL AFTER requester_confirmed_by_user_id,
  ADD COLUMN supplier_confirmed_by_user_id BIGINT UNSIGNED NULL AFTER requester_confirmed_at,
  ADD COLUMN supplier_confirmed_at DATETIME(3) NULL AFTER supplier_confirmed_by_user_id,
  ADD COLUMN confirmed_at DATETIME(3) NULL AFTER supplier_confirmed_at,
  ADD COLUMN logistics_mode VARCHAR(40) NOT NULL DEFAULT 'pending' AFTER confirmed_at,
  ADD COLUMN logistics_status VARCHAR(40) NOT NULL DEFAULT 'pending_coordination' AFTER logistics_mode,
  ADD COLUMN origin_city VARCHAR(120) NULL AFTER logistics_status,
  ADD COLUMN origin_department VARCHAR(120) NULL AFTER origin_city,
  ADD COLUMN destination_city VARCHAR(120) NULL AFTER origin_department,
  ADD COLUMN destination_department VARCHAR(120) NULL AFTER destination_city,
  ADD COLUMN pickup_place VARCHAR(300) NULL AFTER destination_department,
  ADD COLUMN scheduled_date DATE NULL AFTER pickup_place,
  ADD COLUMN time_window VARCHAR(80) NULL AFTER scheduled_date,
  ADD COLUMN logistics_notes VARCHAR(1000) NULL AFTER time_window,
  ADD UNIQUE KEY uq_material_requests_public_code (public_code),
  ADD KEY ix_material_requests_requester (requesting_organization_id, status),
  ADD KEY ix_material_requests_need (project_need_id),
  ADD CONSTRAINT fk_material_requests_need FOREIGN KEY (project_need_id) REFERENCES project_material_needs (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_requests_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_requests_requester_user FOREIGN KEY (requester_confirmed_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_requests_supplier_user FOREIGN KEY (supplier_confirmed_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT ck_material_requests_status CHECK (status IN (
    'draft', 'submitted', 'under_review', 'counter_proposed', 'accepted', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled', 'expired'
  )),
  ADD CONSTRAINT ck_material_requests_public_code CHECK (public_code IS NULL OR public_code REGEXP '^req_[a-z0-9]{20}$'),
  ADD CONSTRAINT ck_material_requests_message CHECK (message IS NULL OR CHAR_LENGTH(TRIM(message)) > 0),
  ADD CONSTRAINT ck_material_requests_logistics_mode CHECK (logistics_mode IN ('pending', 'pickup_by_requester', 'delivery_by_supplier', 'third_party')),
  ADD CONSTRAINT ck_material_requests_logistics_status CHECK (logistics_status IN (
    'pending_coordination', 'scheduled', 'ready_for_pickup', 'cancelled'
  ));

ALTER TABLE deliveries
  ADD COLUMN public_code VARCHAR(32) NULL AFTER id,
  ADD COLUMN dispatched_by_user_id BIGINT UNSIGNED NULL AFTER delivery_notes,
  ADD COLUMN received_quantity DECIMAL(14, 3) NULL AFTER dispatched_by_user_id,
  ADD COLUMN received_at DATETIME(3) NULL AFTER received_quantity,
  ADD COLUMN received_by_user_id BIGINT UNSIGNED NULL AFTER received_at,
  ADD COLUMN receipt_condition VARCHAR(40) NULL AFTER received_by_user_id,
  ADD COLUMN receipt_notes VARCHAR(1000) NULL AFTER receipt_condition,
  ADD COLUMN operation_key VARCHAR(80) NULL AFTER receipt_notes,
  ADD UNIQUE KEY uq_deliveries_public_code (public_code),
  ADD UNIQUE KEY uq_deliveries_operation (operation_key),
  ADD CONSTRAINT fk_deliveries_dispatched_by FOREIGN KEY (dispatched_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_deliveries_received_by FOREIGN KEY (received_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT ck_deliveries_public_code CHECK (public_code IS NULL OR public_code REGEXP '^shp_[a-z0-9]{20}$'),
  ADD CONSTRAINT ck_deliveries_receipt CHECK (
    received_quantity IS NULL
    OR (received_quantity > 0 AND delivered_quantity IS NOT NULL AND received_quantity <= delivered_quantity AND received_at IS NOT NULL)
  ),
  ADD CONSTRAINT ck_deliveries_receipt_condition CHECK (
    receipt_condition IS NULL OR receipt_condition IN ('good', 'fair', 'deteriorated', 'different', 'not_declared')
  );

CREATE TABLE request_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  conditions_text VARCHAR(2000) NULL,
  author_user_id BIGINT UNSIGNED NOT NULL,
  author_organization_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_request_proposals_version (request_id, version_number),
  CONSTRAINT fk_request_proposals_request FOREIGN KEY (request_id) REFERENCES material_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_request_proposals_author FOREIGN KEY (author_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_request_proposals_organization FOREIGN KEY (author_organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_request_proposals_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Propuesta o contraoferta. No es la reserva ni el acuerdo confirmado.';

CREATE TABLE request_operations (
  operation_key VARCHAR(80) NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  action_name VARCHAR(40) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_key),
  CONSTRAINT fk_request_operations_request FOREIGN KEY (request_id) REFERENCES material_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE request_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  organization_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  operation_key VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_request_events_operation (operation_key),
  KEY ix_request_events_request (request_id, id),
  CONSTRAINT fk_request_events_request FOREIGN KEY (request_id) REFERENCES material_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_request_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_request_events_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_request_events_type CHECK (event_type IN (
    'created', 'submitted', 'reviewed', 'counter_proposed', 'accepted', 'reserved', 'rejected', 'cancelled',
    'reservation_released', 'logistics_updated', 'dispatched', 'received', 'incident_opened', 'incident_resolved',
    'document_added', 'finished', 'expired'
  )),
  CONSTRAINT ck_request_events_description CHECK (CHAR_LENGTH(TRIM(description)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operation_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(40) NOT NULL,
  message VARCHAR(500) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_operation_notifications_org (organization_id, read_at, id),
  CONSTRAINT fk_operation_notifications_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operation_notifications_request FOREIGN KEY (request_id) REFERENCES material_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_operation_notifications_message CHECK (CHAR_LENGTH(TRIM(message)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bandeja interna. No representa un correo enviado.';

CREATE TABLE logistics_incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  delivery_id BIGINT UNSIGNED NULL,
  incident_type VARCHAR(40) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  resolution VARCHAR(2000) NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  resolved_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_logistics_incidents_request (request_id, status),
  CONSTRAINT fk_logistics_incidents_request FOREIGN KEY (request_id) REFERENCES material_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_logistics_incidents_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_logistics_incidents_author FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_logistics_incidents_resolver FOREIGN KEY (resolved_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_logistics_incidents_type CHECK (incident_type IN (
    'unavailable', 'short_quantity', 'delay', 'condition_difference', 'delivery_cancelled', 'receipt_pending'
  )),
  CONSTRAINT ck_logistics_incidents_status CHECK (
    (status = 'open' AND resolution IS NULL AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolution IS NOT NULL AND CHAR_LENGTH(TRIM(resolution)) > 0 AND resolved_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operation_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  original_name VARCHAR(120) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_documents_key (storage_key),
  KEY ix_operation_documents_request (request_id),
  CONSTRAINT fk_operation_documents_request FOREIGN KEY (request_id) REFERENCES material_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operation_documents_material FOREIGN KEY (material_id) REFERENCES materials (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operation_documents_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operation_documents_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Archivo aportado por una parte. No queda verificado ni certificado.';
