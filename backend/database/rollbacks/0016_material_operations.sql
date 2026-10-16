DROP TABLE operation_documents;
DROP TABLE logistics_incidents;
DROP TABLE operation_notifications;
DROP TABLE request_events;
DROP TABLE request_operations;
DROP TABLE request_proposals;

ALTER TABLE deliveries
  DROP FOREIGN KEY fk_deliveries_dispatched_by,
  DROP FOREIGN KEY fk_deliveries_received_by,
  DROP CHECK ck_deliveries_public_code,
  DROP CHECK ck_deliveries_receipt,
  DROP CHECK ck_deliveries_receipt_condition,
  DROP INDEX uq_deliveries_public_code,
  DROP INDEX uq_deliveries_operation,
  DROP COLUMN operation_key,
  DROP COLUMN receipt_notes,
  DROP COLUMN receipt_condition,
  DROP COLUMN received_by_user_id,
  DROP COLUMN received_at,
  DROP COLUMN received_quantity,
  DROP COLUMN dispatched_by_user_id,
  DROP COLUMN public_code;

ALTER TABLE material_requests
  DROP FOREIGN KEY fk_material_requests_organization;

ALTER TABLE material_requests
  DROP FOREIGN KEY fk_material_requests_need,
  DROP FOREIGN KEY fk_material_requests_created_by,
  DROP FOREIGN KEY fk_material_requests_requester_user,
  DROP FOREIGN KEY fk_material_requests_supplier_user,
  DROP CHECK ck_material_requests_status,
  DROP CHECK ck_material_requests_public_code,
  DROP CHECK ck_material_requests_message,
  DROP CHECK ck_material_requests_logistics_mode,
  DROP CHECK ck_material_requests_logistics_status,
  DROP INDEX uq_material_requests_public_code,
  DROP INDEX ix_material_requests_requester,
  DROP INDEX ix_material_requests_need,
  DROP COLUMN logistics_notes,
  DROP COLUMN time_window,
  DROP COLUMN scheduled_date,
  DROP COLUMN pickup_place,
  DROP COLUMN destination_department,
  DROP COLUMN destination_city,
  DROP COLUMN origin_department,
  DROP COLUMN origin_city,
  DROP COLUMN logistics_status,
  DROP COLUMN logistics_mode,
  DROP COLUMN confirmed_at,
  DROP COLUMN supplier_confirmed_at,
  DROP COLUMN supplier_confirmed_by_user_id,
  DROP COLUMN requester_confirmed_at,
  DROP COLUMN requester_confirmed_by_user_id,
  DROP COLUMN proposal_version,
  DROP COLUMN created_by_user_id,
  DROP COLUMN message,
  DROP COLUMN project_need_id,
  DROP COLUMN public_code;

ALTER TABLE material_requests
  ADD CONSTRAINT fk_material_requests_organization FOREIGN KEY (requesting_organization_id) REFERENCES organizations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT ck_material_requests_status CHECK (status IN (
    'draft', 'submitted', 'accepted', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled'
  ));
