---
date: 2025-12-18
nature:
  - Génération
models:
  - ChatGPT 5.2 Thinking
---

# Cluster “grafting” specs (Intermarc NG) — formal rules

This document formalizes how fields (“zones”) from **clustered works** are incorporated into the **anchor work** when the user clicks:

> **Greffer les zones des œuvres mises en grappe.**  
(new button you should implement, located under the anchor work’s Intermarc record, inside `div.editor-actions`)

---

## 0) Data model and shared definitions

### NNB
The "Numéro de Notice BNF" (NNB) can be deduced from the last segment of an ARK identifier by stripping "cb" & the last character: `ark:/12148/cb1000083760` → `100008376`. Throughout the codebase we do this ARK → record_id conversion frequently.

### Records / works
- A **cluster** = `anchor_work` + `member_works[]` (the “replaced” works).
- Each work has:
  - `nnb: int` (higher = more recent)
  - `record: List[Field]`

### Field / subfield representation
- `Field.tag: str` (e.g. `"040"`, `"39A"`, `"62T"`, `"960"`, etc.)
- `Field.subfields: List[Subfield]`
- `Subfield.code: str` (e.g. `"a"`, `"q"`, `"3"`, `"L"`)
- `Subfield.value: str`

### “Exact equality” (used for many dedup rules)
Two fields are **exactly equal** if:
- same `tag`
- same ordered list of `(code, value)` pairs after normalizing whitespace (`strip()`; optionally collapse internal spaces if your data is noisy)

### 999 conversion
Several rules say “pass into 999”. Define a single helper:

- `to_999(field, origin_tag, origin_nnb=None, add_mmd_nnb=False) -> Field`

Set 999 subfield `fo` to "Intermarc NG", `et` to origin_tag, then `subfield_code` to subfield_value for (subfield_code, subfield_value) in field, without deduplication. Examples:
- `300 $a foo $a bar` → `999 $fo Intermarc NG $et 300 $a foo $a bar`
- `609 $q ark:/12148/cb1000083760 $a Ségur $m Ctesse de $j HA` → `999 $fo Intermarc NG $et 609 $q ark:/12148/cb1000083760 $a Ségur $m Ctesse de $j HA`

### Meta-metadata (“MMD”) for language/script (used in 150/450)
- Treat `$L`, `$E`, `$T` as “meta-metadata” subfields (MMD-LET).
- When comparing/deduping 150/450 “ignoring meta-metadata”, exclude `$L/$E/$T` from the comparison key.

---

## 1) Baseline behavior: “simple graft + exact dedup”
For these tags:

`016, 39A, 043, 057, 073, 075, 076, 304, 350, 501, 552, 558, 628, 644, 681, 682, 683, 686, 02A, 02V, 30P, 35S, 55P, 62A, 62G, 62I, 62L`

**Rule:** take all occurrences from all member works, add them to the anchor, then **deduplicate by exact equality** (same tag + same content).  
Idempotent: running twice does not create more duplicates.

---

## 2) Field 040 — grouped by `$q`, partial handling, conflicts

### Intent
Within the same `$q`:
- If whole zone identical → deduplicate
- If one is partial and what is present matches the other → keep the **most complete**
- If at least some info differs → keep **distinct** zones  
Different `$q` → keep distinct zones

### Definitions
- Let `q = value of first $q` (or `None` if missing). Group by `q` value.
- Define **core subfields** = all subfields (including `$q`) for “exact equality” checks.
- Define **partial compatibility** for two 040 fields with the same `$q`:
  - For every subfield code that appears in both fields, the **multiset** of values for that code must match
  - One field is considered “more complete” if it has a strict superset of `(code,value)` pairs

> This implements “partial but filled info identical → keep most complete” without synthesizing new hybrid fields.

### Algorithm
1. Collect all 040 fields from `members`.
2. Partition by `$q` value (treat missing `$q` as its own group).
3. In each `$q` group:
   - Remove exact duplicates.
4. The remaining 040 fields are added to the anchor if there is no exact 040 field match for it already.

---

## 3) Field 041 — dedupe among members; keep vs 999 depending on anchor presence

### Rule
1. Let `A = anchor.fields("041")`.
2. Let `M = all 041 fields from member works`, deduplicated among themselves (exact equality).

**Case 1 — anchor already has at least one 041:**
- For each `f in M`:
  - If `f` exactly equals any field in `A` → discard
  - Else → convert `f` to 999 in the anchor

**Case 2 — anchor has no 041:**
- Add all deduplicated `M` to the anchor as 041 fields.

---

## 4) Fields 150 and 450 — convert member 150 → anchor 450; then dedupe/normalize 450 set

### Source intent (combined 150 + 450 lines)
- Member works’ **150 become 450** in the anchor
- Also bring member works’ **450** into anchor’s 450 pool (implied by the “450 rules” applying to all 450s)
- Deduplicate 450s:
  - between themselves and/or with one of the anchor’s 150
  - **case-sensitive**: different capitalization variants are kept as distinct 450s
  - **ignore meta-metadata** ($L/$E/$T) when deciding whether two fields are “the same”; keep the form with **most** MMD-LET
  - if MMD-LET values diverge: keep either the anchor’s (retained work) or the most recent (highest NNB)

### Formalization

#### 4.1 Build candidate 450 pool
- Start with anchor’s existing `450` fields.
- Add every member `450` field (copied as-is).
- Convert every member `150` field to a `450` field:
  - same subfields, only tag changes `150 → 450`
  - (do **not** case-normalize `$a`; keep exactly as provided)

#### 4.2 Drop 450 that duplicates an anchor 150 (core-equality)
- Compare **core keys**: all subfields **except** `$L/$E/$T`.
- If a candidate 450’s core key matches any anchor 150 core key → drop that 450.

#### 4.3 Deduplicate 450 among themselves by core key, selecting the “best” representative
- Group remaining 450 candidates by `core_key_ignoring_LET`.
- For each group:
  1. Prefer a field that already exists on the **anchor** (if present in the group).
  2. Else pick the field with the **largest count of distinct** `$L/$E/$T` subfields present.
  3. If multiple remain and `$L/$E/$T` values differ:
     - pick the one from the **highest NNB** member (most recent)
  4. If still tied: deterministic fallback (stable first-seen)

**Result:** write the resolved 450 set back to the anchor (remove old 450, insert resolved).

### Key point about capitalization variants
Because grouping is **case-sensitive**, these remain distinct core keys and therefore distinct 450s:
- `$a ORGUEIL ET PREJUGES`
- `$a orgueil et préjugés`
- `$a Orgueil et Préjugés`
- `$a Orgueil et préjugés`

---

## 5) Field 300 — compare to anchor; non-identical member 300 → 999

### Rule
- For each member `300` field:
  - If it exactly equals any anchor `300` field → discard
  - Else → convert it to 999 in the anchor
- Do **not** add new 300 fields to the anchor.

(Optionally dedupe the moved-to-999 set to avoid repeated 999 copies of the same original 300.)

---

## 6) Field 609 — depends on presence of any 96X indexing

### Condition
- Let `has_any_96X = any(work has tag matching r"^96." for any work in cluster)`

### Rule
**If `has_any_96X` is false:**
- Collect all 609 fields across cluster
- Deduplicate by exact equality
- Store them as anchor 609 fields (single combined set)

**If `has_any_96X` is true:**
- Move **all** 609 fields present anywhere in the cluster into 999 on the anchor
- Anchor ends with **no 609** fields

---

## 7) Field 629 — one resulting 629 with deduped subfields

### Rule
- Collect **all subfields** from all 629 fields across the cluster.
- Deduplicate subfields by `(code, value)` (exact match after whitespace normalization).
- Create exactly **one** 629 field on the anchor containing the deduped subfields.

### Ordering (deterministic)
- Start with anchor’s 629 subfields in original order
- Then iterate member works in **descending NNB**, appending unseen subfields in encountered order

---

## 8) Field 680 — keep/choose one 680; other Dewey-distinct 680 → 999 with mandatory NNB MMD

### Needed configurable extraction

- `dewey_key(field_680) -> str | None`

Two 680 fields are considered identical if there `da`, `dg`, `di` fields are the same.

### Rule
Let `anchor_has_680 = len(anchor.680) > 0`.

**If anchor has 680:**
- Keep anchor’s existing 680 field(s) unchanged.
- For all member 680 fields:
  - Deduplicate **by Dewey key** (one per Dewey key)
  - Convert each kept one to 999 in anchor
  - **Mandatory:** add MMD with the origin work’s NNB in the 999 payload

**If anchor has no 680:**
- Among all works that have at least one 680, pick the work with **highest NNB**; add its 680 field to anchor as 680.
- For 680 fields from all *other* works:
  - Deduplicate by Dewey key
  - Convert to 999 with **mandatory** origin-NNB MMD

---

## 9) Field 685 — gated by presence of any 96X or any 609

### Condition
`has_96X_or_609 = (any 96X anywhere in cluster) OR (any 609 anywhere in cluster)`

### Rule
**If `has_96X_or_609` is false:**
- Collect all 685 across cluster, exact-dedupe, add to anchor as 685

**If `has_96X_or_609` is true:**
- Move **all** 685 anywhere in the cluster to anchor 999
- Anchor ends with **no 685**

---

## 10) Fields 700 / 701 / 702 / 710 / 711 — merge by `$3`, union subfields (notably multiple `$4`)

### Rule (per tag independently)
For each of `700`, `701`, `702`, `710`, `711`:

1. Partition fields by `$3` value:
   - If `$3` is missing, treat the whole field as its own key (fall back to exact dedup only).
2. For each `$3` group:
   - Create one merged field:
     - start from the anchor’s field for that `$3` if present, else the most recent member’s (highest NNB)
     - for every subfield code, append any **missing** `(code,value)` pairs found in other fields
     - allow repeated codes (e.g. `$4`) as long as `(code,value)` is distinct
3. Replace anchor’s existing fields of that tag with the merged set.

---

## 12) Field 860 — keep if present; else choose most recent; others → 999

### Rule
**If anchor has at least one 860:**
- Keep anchor 860 as-is
- Convert all member 860 fields to 999

**If anchor has no 860:**
- Find the work with the **highest NNB** that has at least one 860
- Copy that work’s 860 field(s) into anchor as 860
- Convert all other works’ 860 fields to 999

(Perform exact-dedupe before creating 999 entries.)

---

## 13) Field 968 — keep anchor’s, plus top-N most recent works with 968

### Rule
Let `works_with_968 = [work for work in cluster if work has >=1 field 968 and work != cluster.anchor]`, sorted by `NNB desc`.

**If anchor has one or more 968:**
- Keep all anchor 968
- Also keep all 968 from the single most recent work in `works_with_968` (highest NNB)

**If anchor has no 968:**
- Keep all 968 from the two most recent works in `works_with_968` (highest NNB first)

Finally, exact-dedupe the resulting 968 set.

---

## 14) Field 62T — one resulting 62T with deduped subfields

Same as §7 (629), but for tag `62T`:
- exactly one 62T in anchor
- union and dedupe subfields `(code,value)`

---

## 15) 96X (excluding 968) — frequency threshold vs “top 3 most recent” rule

### Scope
Apply to all tags matching `^96.` **except** `968`. (e.g. 960–967, 969, and any alphanumeric third char)

Define:
- `FIELDS_96X = all such fields across cluster`
- A subject-indexing string = a single 96X field, compared by **exact equality** (tag + fields `3`, `3x`, `3y`, `3z`)

### Step 1 — count works that have 96X (excluding 968)
- `works_with_96x = { work | work has at least one 96X≠968 }`
- Let `k = len(works_with_96x)`

### Case A — `k > 3` (frequency rule)
1. Compute **per-work presence frequency** of each unique 96X chain:
   - A chain counts at most once per work (even if duplicated within a record)
2. For each chain:
   - If `freq > 3`: put **one** instance in anchor as the original 96X tag
   - Else (`freq <= 3`): convert it into anchor 999
3. Anchor ends with only those 96X chains that appear in **more than 3** works.

Ordering suggestion (deterministic):
- For retained 96X: sort by `(freq desc, tag asc, serialized_content asc)`
- For moved-to-999: same

### Case B — `k <= 3` (keep “three most recent” chains)
1. Traverse works in **descending NNB**; within each work, traverse its 96X fields in record order.
2. Build a list of unique chains in first-seen order (exact dedupe while preserving traversal order).
3. Take the first **3** chains:
   - keep them in anchor as original 96X tags
4. Any remaining chains:
   - convert into anchor 999