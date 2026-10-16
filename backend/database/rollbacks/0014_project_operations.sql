-- Quita la operación nueva. No borra proyectos ni necesidades ya registrados.
-- No vuelve a estrechar los estados: una fila archivada o satisfecha impediría restaurar el CHECK anterior.
-- Si project_events tiene filas, el migrador se niega a eliminar la tabla.

DROP TABLE IF EXISTS project_events;

ALTER TABLE project_material_needs DROP CHECK ck_project_material_needs_public_code;
ALTER TABLE project_material_needs DROP CHECK ck_project_material_needs_title;
ALTER TABLE project_material_needs DROP CHECK ck_project_material_needs_priority;
ALTER TABLE project_material_needs DROP CHECK ck_project_material_needs_visibility;
ALTER TABLE project_material_needs DROP INDEX uq_project_material_needs_public_code;
ALTER TABLE project_material_needs
  DROP COLUMN public_code,
  DROP COLUMN title,
  DROP COLUMN specifications_json,
  DROP COLUMN observations,
  DROP COLUMN city,
  DROP COLUMN department,
  DROP COLUMN location_description,
  DROP COLUMN priority,
  DROP COLUMN visibility;

ALTER TABLE projects DROP FOREIGN KEY fk_projects_responsible;
ALTER TABLE projects DROP CHECK ck_projects_public_code;
ALTER TABLE projects DROP CHECK ck_projects_visibility;
ALTER TABLE projects DROP CHECK ck_projects_address;
ALTER TABLE projects DROP INDEX uq_projects_public_code;
ALTER TABLE projects
  DROP COLUMN public_code,
  DROP COLUMN responsible_user_id,
  DROP COLUMN visibility,
  DROP COLUMN address;
