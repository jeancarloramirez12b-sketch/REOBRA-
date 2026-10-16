DROP TABLE impact_audit_events;
DROP TABLE impact_report_items;
DROP TABLE impact_reports;
DROP TABLE impact_calculation_sources;
DROP TABLE impact_calculations;
DROP TABLE impact_mass_parameters;
DROP TABLE impact_factors;
DROP TABLE impact_methodologies;

ALTER TABLE deliveries DROP INDEX ix_deliveries_received;

DELETE FROM measurement_units WHERE code = 'g';
