# Adaptation Detection Findings

This note documents why several `Les petites filles modèles` works from `vendange.sqlite` missed the adaptation pipeline and the adjustments required to cover them.

## 1. ark:/12148/cb25828055z
- **Evidence**: Manifestation `245` field contains both `d'après la comtesse de Ségur` and `adaptation, Jean-Claude Lowenthal ; dessins, Louis-Michel Carpentier` (`records.id = 34701720`). The run only logs illustration matches and keeps the work in a straight cluster: `data_curation.log` lines around `[25828055]`.
- **Root cause**: `_evaluate_subset` only inspects *extra* agents (present in the candidate adaptation but absent from the smaller work). The actual adapter is missing from `7XX`; the only extra agent is the illustrator, so adaptation cues that reference the **shared** author never trigger `_agent_linked_to_adaptation`. The pair therefore falls back to clustering.
- **Fix**: When we detect adaptation triggers in a manifestation, re-run the dependency test against the full agent set (work + manifestation) rather than restricting to extras. A simple approach is to call `_entity_adaptation_signals` inside `_evaluate_subset` as a fallback before accepting the cluster.

## 2. ark:/12148/cb83936069w
- **Evidence**: `150$u` equals `d'après la Comtesse de Ségur` (see `records.id = 83936069`). The run never flags it as adaptation and skips links (`data_curation.log`, `[83936069 ↔ …] Skipping adaptation link; both works reference source creator role`).
- **Root cause**: `_is_adaptation` previously inspected only `150$a`. Works whose adaptation mention lives in `150$u` were downgraded to regular originals.
- **Fix**: Extend `_is_adaptation` (or its helper) to scan both `150$a` and `150$u` before caching the flag. This also keeps normalised title cleaning consistent.

## 3. ark:/12148/cb80948337c
- **Evidence**: The curated record mixes `552$q` values for both `Est une adaptation de` and `A pour adaptation` although its title already encodes “d'après la Ctesse de Ségur…”. The log shows the work recorded as origin for several pairs and as adaptation for others (`data_curation.log`, block starting `DEBUG    [20548677 → 80948337]…`).
- **Root cause**: `_record_adaptation_pair` allows links even when *both* works carry adaptation signals. Depending on evaluation order, one adaptation may be used as the “anchor”, creating outgoing `A pour adaptation` links in addition to incoming `Est une adaptation de`.
- **Fix**: Short-circuit `_record_adaptation_pair` when `origin` and `adaptation` both return `_entity_adaptation_signals == True` (and/or both expose the source‐creator relator). Clustering keeps these adaptations together; no adaptation relationship should be emitted.

## 4. ark:/12148/cb270324620
- **Evidence**: The log detects the adaptation (“Adaptation inferred via source creator relator”) but skips the link twice: once with cb83936069w and once with cb23779331m (`data_curation.log`, `[83936069 ↔ 27032462] Skipping adaptation link; both works reference source creator role`). No attempt is logged against the canonical original cb205486774.
- **Root cause**: Agent counters use `(ark, relator)` as the key. The original work stores the author with relator `Auteur du texte`, whereas the adaptation swaps the same ARK into `Créateur de l'œuvre source`. `_is_subset_counter` therefore fails and the pair never reaches `_evaluate_subset`. The only comparisons that remain involve other adaptations (that also expose the source-creator relator), which we then skip.
- **Fix**: Normalise `AgentResponsibility` keys when building counters: treat `Auteur du texte` and `Créateur de l'œuvre source` as equivalent (and, more generally, collapse relators that indicate “original author”). Once the author matches, `_evaluate_subset` sees the adapter (relator `Responsable de l'adaptation`) as the extra agent and can flag the work as an adaptation of the anchor.

## 5. ark:/12148/cb829076540
- **Evidence**: Manifestation title `'Les |petites filles modèles [Paris, Théâtre du Petit monde, 13 octobre 1927] d'après le roman de Mme de Ségur par Paul de Pitray'` is cached with “adaptation triggers: False” (`data_curation.log` line 6168) along with `Skipping unmatched adaptation trigger '1927] d''`.
- **Root cause**: `match_variants_in_title` maps the folded match for `d'après` to the character range `[927] d'` (the closing bracket plus “d'”). `doc.char_span` therefore returns the wrong span and `_build_adaptation_triggers` discards it. The root token `après` is never captured, so no adaptation trigger is emitted.
- **Fix**: Post-process adaptation matches that end on `d'` (or, more generally, a case particle) by extending the character range to the next alphabetic token when the following token is `après`. Alternatively, adjust `match_variants_in_title` to include the next grapheme whenever a trailing apostrophe would truncate the match.

## 6. Other cases (cb83936069w, cb250301612, cb250301763)
- **cb83936069w**: same `150$u` issue as point 2 (fixed once `150$u` is scanned).
- **cb250301612 & cb250301763**: both film records hold the original author under the *source creator* relator (`700$4 = cb100005951f`) alongside one or more `Responsable de l'adaptation` relators. Because the original texts keep the author under `cb1000059494`, agent counters disagree and `_is_subset_counter` declines the pair. The only evaluated comparison paths therefore involve other adaptations, all of which are skipped as noted above.
- **Fix**: The same relator normalisation described under point 4 unlocks these links. In addition, once `_entity_adaptation_signals` runs on the whole agent set, works that only express adaptation information through shared agents will finally be classified.

## Suggested code changes
1. **Relator harmonisation**  
   Map `AgentResponsibility` keys to a canonical bucket before counting. At minimum, collapse `"Auteur du texte / Autrice du texte"` and `"Créateur de l'œuvre source (Auteur du texte) / Créatrice de l'œuvre source (Autrice du texte)"`. The subset tests (`_is_subset_counter`) should compare on `(ark, canonical_role)` so adaptations with re-labelled authors still match the anchor.
2. **Fallback adaptation detection inside `_evaluate_subset`**  
   If extras do not expose an adaptation relator and `_agent_linked_to_adaptation` never fires, invoke `_entity_adaptation_signals` on both works. When either work gathers adaptation cues via shared agents or manifestation-only credit, treat the larger work as an adaptation instead of clustering.
3. **Skip adaptation links when both sides are adaptations**  
   In `_record_adaptation_pair`, after computing the orientation, abort the link if both entities still report `_entity_adaptation_signals == True` (or both carry the source-creator relator). This prevents the mixed `A pour adaptation` / `Est une adaptation de` scenario.
4. **`d'après` span repair**  
   Enhance `_build_adaptation_triggers` (or `match_variants_in_title`) so that matches ending in `'d'` automatically extend over the following token when it equals `après`. Logging already shows the truncation (`Skipping unmatched adaptation trigger '1927] d''`); widening that span allows the trigger to be categorised as `head_subtree`.
5. **`150$u` ingestion**  
   Ensure `_is_adaptation` consults both `150$a` and `150$u` (this is necessary for cb83936069w and cb23779331m).
