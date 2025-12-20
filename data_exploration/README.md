# data_exploration
---

- subset_by_150.py:
  1. The needle parameter is a regex (case-insensitive) applied to 150 subfields stored in Postgres.
  2. The script creates a new Postgres dataset partition and copies matching entities + projections (entity/label/field/subfield/rel_edge/etc.).
  3. When extracting a subset from the Comtesse de Ségur data set, always make sure to include "Cadichon|Mémoires d'un âne|" in the needle so as to extract works that carry the bilateral adaptation controlled values.
