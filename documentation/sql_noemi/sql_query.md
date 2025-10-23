Insert in the first array the list of works taken from comtesse_segur_work_ids.txt:

```sql
-- 0) your list once
DROP TABLE IF EXISTS ids;
CREATE TEMP TABLE ids(id bigint) ON COMMIT DROP;
INSERT INTO ids(id)
SELECT UNNEST(ARRAY[
-- list of ids of work entities goes here
])::bigint;

-- 1) hop_750
DROP TABLE IF EXISTS hop_750;
CREATE TEMP TABLE hop_750 AS
SELECT DISTINCT ee.id_entitelrm_source AS id
FROM noemiprod.entitelrm_entitelrm ee
JOIN ids i ON i.id = ee.id_entitelrm_destination
WHERE ee.codesouszone = '750$3';

SELECT 'hop_750 rows' AS stage, COUNT(*) AS n FROM hop_750;

-- 2) hop_740
DROP TABLE IF EXISTS hop_740;
CREATE TEMP TABLE hop_740 AS
SELECT DISTINCT ee2.id_entitelrm_source AS id
FROM noemiprod.entitelrm_entitelrm ee2
JOIN hop_750 h ON h.id = ee2.id_entitelrm_destination
WHERE ee2.codesouszone = '740$3';

SELECT 'hop_740 rows' AS stage, COUNT(*) AS n FROM hop_740;

-- 3) base_ids
DROP TABLE IF EXISTS base_ids;
CREATE TEMP TABLE base_ids AS
SELECT id FROM ids
UNION SELECT id FROM hop_750
UNION SELECT id FROM hop_740;

SELECT 'base_ids rows' AS stage, COUNT(*) AS n FROM base_ids;

-- 4) base_rows (limit while debugging to see if regex is the culprit)
DROP TABLE IF EXISTS base_rows;
CREATE TEMP TABLE base_rows AS
SELECT e.id_entitelrm, e.type_entite, e.intermarc, e.intermarc::text AS intermarc_txt
FROM noemiprod.entitelrm e
JOIN base_ids b ON b.id = e.id_entitelrm
LIMIT 100;

SELECT 'base_rows rows' AS stage, COUNT(*) AS n FROM base_rows;

-- 5) ark scraping (again, limit while testing)
DROP TABLE IF EXISTS ark_hits;
CREATE TEMP TABLE ark_hits AS
SELECT
  b.id_entitelrm AS source_id,
  (m)[1]         AS ark_full,
  LEFT((m)[2], LENGTH((m)[2]) - 1) AS derived_id_text
FROM base_rows b
CROSS JOIN LATERAL regexp_matches(
  b.intermarc_txt,
  '(ark:/12148/cb([0-9a-z]+))',
  'gi'
) AS m;

SELECT 'ark_hits rows' AS stage, COUNT(*) AS n FROM ark_hits;

DROP TABLE IF EXISTS norm;
CREATE TEMP TABLE norm AS
SELECT NULLIF(derived_id_text,'')::bigint AS id
FROM ark_hits
WHERE derived_id_text <> '';

SELECT 'norm ids rows' AS stage, COUNT(*) AS n FROM norm;

-- 6) final
SELECT e.id_entitelrm, e.type_entite, e.intermarc
FROM noemiprod.entitelrm e
JOIN (
  SELECT id FROM base_ids
  UNION
  SELECT id FROM norm
) AS all_ids ON e.id_entitelrm = all_ids.id
ORDER BY e.id_entitelrm;
```