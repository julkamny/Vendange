-- Flatten Intermarc JSON into relational views for Ontop mappings.

CREATE OR REPLACE VIEW v_field AS
SELECT
  dataset_id,
  entity_id,
  idx AS field_idx,
  field->>'code' AS tag,
  field,
  field->>'compact_value' AS compact_value
FROM entity,
LATERAL jsonb_array_elements(record->'zones') WITH ORDINALITY AS arr(field, idx);

CREATE OR REPLACE VIEW v_subfield AS
SELECT
  e.dataset_id,
  e.entity_id,
  f.idx AS field_idx,
  sub_idx,
  sub->>'code' AS code,
  sub->>'valeur' AS value,
  sub
FROM entity e
JOIN LATERAL jsonb_array_elements(record->'zones') WITH ORDINALITY AS f(field, idx) ON TRUE
JOIN LATERAL jsonb_array_elements(f.field->'sousZones') WITH ORDINALITY AS subs(sub, sub_idx) ON TRUE;
