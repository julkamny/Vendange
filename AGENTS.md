## Tips & instructions

- When deriving the internal identifier from an ark, we need to remove the prefix up to `cb` and drop the final control character, e.g. `ark:/12148/cb359748158 -> 35974815`.

## Linked entity ontology

- Links between WEM entities:
	- Parent to children:
		- A manifestation points in its `740$3` subfield to one or more expressions, each expression points in its `750$3` subfield to one single work. A work can have multiple expressions, an expression can have multiple manifestations.
		- A manifestation with ancestor Work A originally, upon cleaning, might end up having as ancestor Work B instead.
	- Clustering: 
		- Entity has a `90F` field in the 'intermarc as json' with a subfield `90F$a` that contains the ark of the clustered entity. Entities can only be clustered with entities of the same nature (œuvre → œuvre, expression → expression, manifestation → manifestation).
- General relationship: 
		- Fields 500, 501, 506, 509, 50N, 54T, 550, 551, 552, 553, 554, 555, 556, 557, 557, 559, 55A, 55B, 55C, 55E, 55F, 55M, 55P, 55R, 55S, 55Z in a work entity (fr. œuvre), pointing in subfield `$3` to the ark of another entity (any of work, expression, manifestation).
		- Fields 501, 506, 509, 50N, 540, 541, 542, 543, 544, 547, 54C, 54P, 54T in an expression entity, pointing in subfield `$3` to the ark of another entity (any of work, expression, manifestation).
		- Fields 501, 506, 509, 50N, 530, 531, 532, 533, 534, 535, 536, 537, 538, 53M in a manistation entity, pointing in subfield `$3` to the ark of another entity (any of work, expression, manifestation).
- Agent to WEM :
	- `$3` subfield in fields 700, 701, 702, as well as 710, 711, 712.

## Vendange.sqlite query findings

- `data_curation/api/db.py` creates `records`, `subfields`, `edges`, and `arks` tables: `records` stores entity metadata (including `type_norm` and ARK), `subfields` stores each MARC subfield with both raw and normalised values, `edges` materialises `$3` links across entities, and `arks` maps every ARK to its internal record id.
- The SQL that surfaced the requested manifestations:

```sql
WITH manifestation_candidates AS (
    SELECT record_id,
           value
    FROM subfields
    WHERE code = '245$a'
      AND value_norm LIKE '%petites filles modeles%'
),
manifestation_edges AS (
    SELECT me.src_id AS manifestation_id,
           a.record_id AS expression_id
    FROM edges me
    JOIN arks a ON a.ark = me.dst_ark
    WHERE me.relation = '740$3'
),
expression_edges AS (
    SELECT ew.src_id AS expression_id,
           a.record_id AS work_id
    FROM edges ew
    JOIN arks a ON a.ark = ew.dst_ark
    WHERE ew.relation = '750$3'
),
works_with_phrase AS (
    SELECT DISTINCT record_id
    FROM subfields
    WHERE zone = '150'
      AND value_norm LIKE '%petites filles modeles%'
)
SELECT m.id AS manifestation_id,
       m.ark AS manifestation_ark,
       CASE
           WHEN m.ark LIKE '%cb%'
           THEN SUBSTR(SUBSTR(m.ark, INSTR(m.ark, 'cb') + 2), 1, LENGTH(SUBSTR(m.ark, INSTR(m.ark, 'cb') + 2)) - 1)
           ELSE NULL
       END AS manifestation_internal_id,
       mc.value AS manifestation_245a,
       e.id AS expression_id,
       e.ark AS expression_ark,
       CASE
           WHEN e.ark LIKE '%cb%'
           THEN SUBSTR(SUBSTR(e.ark, INSTR(e.ark, 'cb') + 2), 1, LENGTH(SUBSTR(e.ark, INSTR(e.ark, 'cb') + 2)) - 1)
           ELSE NULL
       END AS expression_internal_id,
       w.id AS work_id,
       w.ark AS work_ark,
       CASE
           WHEN w.ark LIKE '%cb%'
           THEN SUBSTR(SUBSTR(w.ark, INSTR(w.ark, 'cb') + 2), 1, LENGTH(SUBSTR(w.ark, INSTR(w.ark, 'cb') + 2)) - 1)
           ELSE NULL
       END AS work_internal_id
FROM manifestation_candidates mc
JOIN records m ON m.id = mc.record_id AND m.type_norm = 'manifestation'
JOIN manifestation_edges me ON me.manifestation_id = m.id
JOIN records e ON e.id = me.expression_id AND e.type_norm = 'expression'
JOIN expression_edges ee ON ee.expression_id = e.id
JOIN records w ON w.id = ee.work_id AND w.type_norm = 'oeuvre'
LEFT JOIN works_with_phrase wwp ON wwp.record_id = w.id
WHERE wwp.record_id IS NULL
GROUP BY m.id, m.ark, mc.value, e.id, e.ark, w.id, w.ark
ORDER BY m.id;
```

- Results (internal identifiers follow the `ark:/…/cbXXXX -> XXXX` rule):
	- Manifestation 32624571 (`ark:/12148/cb32624571z`, internal `32624571`) titled “Comtesse de Ségur. |Mémoires d'un âne. Un bon petit diable. Les Malheurs de Sophie. Les Petites filles modèles” links via expression 132294543 (`ark:/12148/cb132294543p`, internal `132294543`) to work 17128531 (`ark:/12148/cb171285319`, internal `17128531`) whose 150 field lists “Les |mémoires d'un âne” plus authority cross-references but no “petites filles modèles”.
	- Manifestation 34737563 (`ark:/12148/cb34737563q`, internal `34737563`) titled “Les |Petites filles modèles” links through expression 100212506 (`ark:/12148/cb1002125066`, internal `100212506`) to work 80948529 (`ark:/12148/cb809485299`, internal `80948529`) with 150 entries “Les |vacances”, control number `B245`, and cluster link `ark:/12148/cb130916590`.
	- Manifestation 38202257 (`ark:/12148/cb38202257t`, internal `38202257`) titled “Les |Petites filles modèles” links through expression 109983481 (`ark:/12148/cb109983481q`, internal `109983481`) to work 25906054 (`ark:/12148/cb25906054w`, internal `25906054`) whose 150 field reads “6 Romans de la Comtesse de Ségur” (plus control `B245`).
	- Manifestation 38535533 (`ark:/12148/cb38535533h`, internal `38535533`) titled “Les |petites filles modèles” links through expression 124872546 (`ark:/12148/cb1248725467`, internal `124872546`) to work 25156384 (`ark:/12148/cb251563849`, internal `25156384`) with 150 field “Les |malheurs de Sophie, [et autres...]” and control `B245`.
	- Manifestation 46987830 (`ark:/12148/cb46987830b`, internal `46987830`) titled “Les |petites filles modèles” links through expression 116000565 (`ark:/12148/cb116000565v`, internal `116000565`) to work 84861490 (`ark:/12148/cb848614906`, internal `84861490`) with 150 field “La |trilogie de Fleurville” and control `B245`.
