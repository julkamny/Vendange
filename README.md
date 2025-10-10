# Vendange
---

_Vérification Experte, Nettoyage et Dédoublonnage des Arbres NOEMI par Grappage Enchâssé_

### Disclaimer
While the ideas behind Vendange's clustering operations and its UI are the result of human reflexion, the code was produced by gpt-5-codex in codex cli.

### Overview
- Python CLI to run modular data-curation operations on Intermarc CSV for IFLA-LRM entities.
- Web UI (Vite + TypeScript) to review, approve/reject/alter merges and export a curated dataset.

### Getting Started
1) Data sources
- current_export.csv is a small sample taken from the database containing the National Library's catalog in Intermarc NG, implementing the RDA-FR conceptual model. 
  - The goal was to gather all works whose agent (field 700, 701 or 702) is Comtesse de Ségur, the expressions pointing to those works, and the manifestations pointing to those manifestations.
  - The initial list of works was obtained from NOEMI, the internal website of the National Library that gives access to its catalog.
  - In the SQL query, we also had to retrieve all entities (agents, works, expressions, manifestations, *valeur contrôlée*, *brand*) whose ark appears in any field of the initial matches, to be able to display the record of those initial matches with all values in human-readable format, as at, the time of writing, there is no API access to the new catalog.
- The list of initial works and the SQL query can be found in folder [sql](sql).

2) Run the clustering CLI
- Input CSV must have headers: `id_entitelrm;type_entite;intermarc` and `intermarc` is a JSON string like `{"zones": [...]}`.
- Operation implemented: cluster works that share same `700$3`, same `015$c`, and whose titles start with the same base substring (ignoring suffixes like "illustrations|vignettes|illustré" followed by "de|par"). NLP is being implemented to strip author and illustrator names from titles when appropriate.
- For each clustered work (besides the anchor), the anchor gets a new `90F` zone with:
  - `90F$a` = ARK of the clustered work (from `001$a`)
  - `90F$q` = `Clusterisation script`
  - `90F$d` = today (YYYY-MM-DD)
- To build the clusters : ```python -m scripts.cli cluster --input data/current_export.csv --output data/curated.csv --clusters-json data/curated.json```

---
📝 
- The current version of curated.csv is not the result of the latest version of the clustering scripts (implementation of NLP is still in progress), but it was curated by hand in Vendange itself to prepare three more or less complete clusters. Adaptations were left out, while an attempt was made to include translations, in abidance with RDA-FR. The anchors of these three clusters are:
  1. ark:/12148/cb205486774 → `150 $3 Ségur Sophie de $a Les |petites filles modèles $9 B245` 
  2. ark:/12148/cb212272085 → `150 $3 Ségur Sophie de $a Les |vacances $9 B245`
  3. ark:/12148/cb27033346q → `$3 Sabran Jean $a Les |bons enfants $9 B245`

### Debug & Fixtures

- **Interactive variant debugging** — set `TITLE_MATCH_DEBUGGER=1` when running the CLI (typically with `-vv`) to drop into `pdb` right before NLP cleaning. Example: ```TITLE_MATCH_DEBUGGER=1 python3 -m scripts.cli -vv detect-contamination --input data/in.csv --out-json data/out.json``` lets you inspect the exact strings matched against the title before spaCy processes them.
- **Styled debug logs** — use `-vv` to unlock Rich-powered logs: the CLI renders colourful panels, syntax-highlighted titles, and tables for matched variants and removed segments.
- **Test fixtures** — every CLI subcommand accepts `--mock NAME` (alias `--test NAME`). When provided, the file `data/test_NAME.csv` is copied over the `--input` path before the operation starts, making it easy to replay curated scenarios.

3) Review in the Web UI
- Start the UI: `npm run dev`
- Default loading: the app automatically loads `/data/curated.csv` and tries `/data/original.csv` or `/data/current_export.csv` at startup.
- Override by filename: click **Load CSVs** to open the modal dropzone, then drop the pair (curated + original) or pick them manually. A file named `curated.csv` replaces the curated dataset; any other `.csv` replaces the original dataset. You can still drag files anywhere in the app for quick overrides.
- The UI detects clusters by scanning for `90F$q = "Clusterisation script"` in works.
- Central panel: list of anchors with merged works (checkbox to accept/reject, option to add ARKs).
- Side panel: prettified Intermarc of selected record.
- Click "Export curated CSV" to download a curated dataset based on Original CSV with overridden edited records from Curated CSV.
- UI quality-of-life:
  - Hierarchical selectors show anchors and clustered entries in clearly separated sections with 🍇 for clustered items.
  - Double-click or use inline mode buttons on cluster/expression banners to jump between works ⇄ expressions ⇄ manifestations, and the pane auto-scrolls to the linked card.
  - Unchecked expressions automatically move to the independent block; their manifestations are greyed out to signal that they will not change the exported CSV.
  - Details banners stay pinned to the top of the panel and the cluster column auto-scrolls to match the entity you pick.

Editing anchors
- Click a work anchor, then "Modify record" to open a JSON editor (CodeMirror) for the anchor’s Intermarc.
- Edit existing zones/subzones or add new ones; click "Save" to apply. Changes are reflected in export and cluster view (e.g., title updates).

Exploring W–E–M links
- Double-click any work (anchor or clustered) to show its Expressions and their Manifestations below the cluster.
- Click an Expression or Manifestation to view its details in the right panel.
- For Expressions with `90F` fields, the UI displays the anchor/clustered hierarchy similarly to works.

Design Notes
- The grouping key for works uses tuple `(015$c, 700$3)`; titles are normalized by stripping suffixes like `illustrations|vignettes|illustré` followed by `de|par` and by case/diacritics-insensitive comparison.
- UI performs all actions client-side; no network dependencies.

### Installation

On MacOS Monterey 12.6.7, use Python 3.11 to install spaCy:

```
uv venv --python 3.11
source .venv/bin/activate
uv pip install "numpy==1.26.4"
uv pip add pip
uv add spacy
python3.11 -m spacy download fr_dep_news_trf
```

### Next Steps

#### Data curation

- Titles consider `150$a` only; we may extend to `450$a`.
- Handle `150$u` properly, to abort clustering or proceed with it depending on the information contained in this subtitle.
- Handle `150$h` and `150$i` subfields, which contain information about volume segmentation and volume title, to avoid clustering two parts of the same work (see RDA-FR).
- Handle cases where works share the same title and at least one creator, but one has more creators than the other.
- Handle adaptations and abridged editions correctly.
- Look for manifestations that should belong to another work, e.g. `245$g` mentions adaptation, while neither the sibling manifestations nor the ancestor work do.
- Finish building the NLP pipeline and ensure the results are accurate in the Comtesse de Ségur dataset and in other samples of the National Library catalog.
- Cluster expressions of a given work when required, e.g. if publishing indications in subfield `014$s` are not relevant, which can only be established upon examining its manifestations.
- Among manifestations of a given expression, check if number of pages varies widely to detect potential adaptations or abridged versions of the text, what would need to be linked to a different expression and/or work.
- Tackle other challenges: 
  - Clustering anonymous works.
  - Clustering ombined works (fr. *œuvre mixte*) with purely textual works (*fr. œuvre textuelle*) when appropriate.
  - Clustering aggregative works (fr. *œuvre agrégative*) with individual works (fr. *œuvre simple*), again when appropriate.
  - Handle cases where the translator is not mentioned, e.g. old translations of the Grimms' tales.
  - Handle book series in which the publisher of the translation divides the original volumes differently, e.g. *Le Trône de fer*, *L'Assassin royal*

#### Technical aspects

- Remove force-directed graphs: visualization in multiple dimensions of graph data requires a different project.