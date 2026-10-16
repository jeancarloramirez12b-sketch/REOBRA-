-- Asistente de REOBRA. Guarda conversaciones, propuestas y consumo.
-- No guarda claves, respuestas completas de herramientas ni documentos.

CREATE TABLE ai_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_code VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NULL,
  title VARCHAR(160) NOT NULL,
  module_context VARCHAR(24) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_conversations_code (public_code),
  KEY ix_ai_conversations_user (user_id, updated_at),
  CONSTRAINT fk_ai_conversations_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_conversations_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_ai_conversations_code CHECK (public_code REGEXP '^cnv_[a-z0-9]{20}$'),
  CONSTRAINT ck_ai_conversations_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT ck_ai_conversations_module CHECK (module_context IS NULL OR module_context IN ('assistant', 'inventory', 'material', 'project', 'matching', 'impact')),
  CONSTRAINT ck_ai_conversations_status CHECK (status IN ('open', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Conversación de un usuario. No se comparte con otra organización.';

CREATE TABLE ai_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(16) NOT NULL,
  basis VARCHAR(24) NOT NULL,
  content VARCHAR(4000) NOT NULL,
  source_note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ai_messages_conversation (conversation_id, id),
  CONSTRAINT fk_ai_messages_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_ai_messages_role CHECK (role IN ('user', 'assistant')),
  CONSTRAINT ck_ai_messages_basis CHECK (basis IN ('user_request', 'system_data', 'inference', 'recommendation', 'guide', 'tool')),
  CONSTRAINT ck_ai_messages_content CHECK (CHAR_LENGTH(TRIM(content)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Mensajes ordenados. El contenido recuperado no se guarda completo.';

CREATE TABLE ai_tool_executions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NULL,
  message_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NULL,
  tool_name VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL,
  row_count INT UNSIGNED NULL,
  error_code VARCHAR(40) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ai_tool_executions_user (user_id, created_at),
  CONSTRAINT fk_ai_tool_executions_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_tool_executions_message FOREIGN KEY (message_id) REFERENCES ai_messages (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_tool_executions_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_tool_executions_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_ai_tool_executions_name CHECK (tool_name IN (
    'list_materials', 'get_material', 'get_passport', 'list_projects', 'list_needs',
    'list_requests', 'list_deliveries', 'explain_need_matches', 'impact_overview', 'list_categories'
  )),
  CONSTRAINT ck_ai_tool_executions_status CHECK (status IN ('ok', 'denied', 'error'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Metadatos de una herramienta de lectura. No guarda la carga devuelta.';

CREATE TABLE ai_action_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_code VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NULL,
  conversation_id BIGINT UNSIGNED NULL,
  kind VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'proposed',
  summary VARCHAR(500) NOT NULL,
  payload_json JSON NOT NULL,
  confirmed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_action_proposals_code (public_code),
  KEY ix_ai_action_proposals_user (user_id, created_at),
  CONSTRAINT fk_ai_action_proposals_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_action_proposals_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_action_proposals_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_ai_action_proposals_code CHECK (public_code REGEXP '^act_[a-z0-9]{20}$'),
  CONSTRAINT ck_ai_action_proposals_kind CHECK (kind IN ('prepare_description', 'suggest_category', 'prepare_need', 'apply_search_filters', 'open_material')),
  CONSTRAINT ck_ai_action_proposals_status CHECK (status IN ('proposed', 'confirmed', 'discarded', 'rejected')),
  CONSTRAINT ck_ai_action_proposals_summary CHECK (CHAR_LENGTH(TRIM(summary)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Propuesta de borrador. Confirmarla no reserva, no despacha y no certifica.';

CREATE TABLE ai_usage_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NULL,
  operation VARCHAR(40) NOT NULL,
  provider VARCHAR(24) NOT NULL,
  model_name VARCHAR(80) NULL,
  input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ai_usage_records_user_time (user_id, created_at),
  KEY ix_ai_usage_records_org_time (organization_id, created_at),
  CONSTRAINT fk_ai_usage_records_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_usage_records_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_ai_usage_records_operation CHECK (operation IN ('chat', 'material_suggestion', 'project_suggestion', 'matching_explain', 'impact_explain')),
  CONSTRAINT ck_ai_usage_records_status CHECK (status IN ('completed', 'not_configured', 'limited', 'error', 'timeout'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Consumo por usuario. No guarda la clave ni el texto enviado al proveedor.';

CREATE TABLE ai_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  rating VARCHAR(16) NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_feedback_message_user (message_id, user_id),
  KEY ix_ai_feedback_message (message_id),
  CONSTRAINT fk_ai_feedback_message FOREIGN KEY (message_id) REFERENCES ai_messages (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_feedback_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_ai_feedback_rating CHECK (rating IN ('helpful', 'not_helpful'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Valoración del usuario sobre una respuesta.';

CREATE TABLE ai_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  subject_type VARCHAR(40) NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  description VARCHAR(300) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ai_audit_events_user (user_id, created_at),
  CONSTRAINT fk_ai_audit_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ai_audit_events_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_ai_audit_events_action CHECK (action IN ('conversation_deleted', 'action_confirmed', 'action_discarded', 'tool_denied')),
  CONSTRAINT ck_ai_audit_events_subject CHECK (subject_type IN ('conversation', 'action', 'tool')),
  CONSTRAINT ck_ai_audit_events_description CHECK (CHAR_LENGTH(TRIM(description)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Hechos operativos del asistente. No incluye secretos ni cargas privadas.';
