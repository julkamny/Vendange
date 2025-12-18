"""Work cluster field grafting (clusterFieldGrafting).

Implements `documentation/cluster_field_grafting/cluster_field_grafting_spec.md`
for works clusters.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import re
from typing import Dict, List, Optional, Sequence

from data_curation.models import Intermarc, SousZone, Zone

from .constants import CLUSTER_FIELD_GRAFTING
from .engine import ClusterAnchorContext


_WS_RE = re.compile(r"\s+")


def _norm_ws(value: str) -> str:
    return _WS_RE.sub(" ", str(value or "").strip())


def _sub_suffix(code_raw: str) -> str:
    return code_raw.split("$", 1)[1] if "$" in code_raw else code_raw


def _clone_zone(zone: Zone, *, new_tag: Optional[str] = None) -> Zone:
    tag = new_tag or zone.code
    old_tag = zone.code
    subs: List[SousZone] = []
    for sub in zone.sousZones:
        code = sub.code
        if new_tag and code.startswith(f"{old_tag}$"):
            code = f"{new_tag}${code.split('$', 1)[1]}"
        subs.append(SousZone(code=code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation))
    return Zone(
        code=tag,
        sousZones=subs,
        field_compact_value=zone.field_compact_value,
        affected_by_curation=zone.affected_by_curation,
    )


def _exact_key(zone: Zone) -> tuple[str, tuple[tuple[str, str], ...]]:
    pairs = tuple((_sub_suffix(sz.code), _norm_ws(sz.valeur)) for sz in zone.sousZones)
    return zone.code, pairs


def _core_key_ignoring_let(zone: Zone) -> tuple[str, tuple[tuple[str, str], ...]]:
    ignored = {"L", "E", "T"}
    pairs = tuple(
        (_sub_suffix(sz.code), _norm_ws(sz.valeur))
        for sz in zone.sousZones
        if _sub_suffix(sz.code) not in ignored
    )
    return zone.code, pairs


def _let_count(zone: Zone) -> int:
    return len({(_sub_suffix(sz.code), _norm_ws(sz.valeur)) for sz in zone.sousZones if _sub_suffix(sz.code) in {"L", "E", "T"}})


def _chain_key_96x(zone: Zone) -> tuple[str, tuple[tuple[str, str], ...]]:
    keep = {"3", "3x", "3y", "3z"}
    pairs = tuple(
        (_sub_suffix(sz.code), _norm_ws(sz.valeur))
        for sz in zone.sousZones
        if _sub_suffix(sz.code) in keep
    )
    return zone.code, pairs


def _tag_is_96x(tag: str) -> bool:
    return len(tag) == 3 and tag.startswith("96")


def _tag_is_96x_excluding_968(tag: str) -> bool:
    return _tag_is_96x(tag) and tag != "968"


def _ark_to_nnb(ark: str) -> int:
    """Best-effort ARK -> NNB conversion per spec.

    Example: ark:/12148/cb1000083760 -> 100008376
    """
    last = (ark or "").rstrip("/").split("/")[-1]
    if last.startswith("cb") and len(last) > 3:
        candidate = last[2:-1]
        if candidate.isdigit():
            return int(candidate)
    digits = "".join(ch for ch in last if ch.isdigit())
    return int(digits) if digits.isdigit() else 0


def _to_999(
    field: Zone,
    *,
    origin_tag: str,
    origin_nnb: Optional[int] = None,
    add_mmd_nnb: bool = False,
    workflow_name: str = CLUSTER_FIELD_GRAFTING,
) -> Zone:
    subs: List[SousZone] = [
        SousZone(code="999$fo", valeur="Intermarc NG"),
        SousZone(code="999$et", valeur=origin_tag),
    ]
    if add_mmd_nnb and origin_nnb is not None:
        subs.append(SousZone(code="999$n", valeur=str(origin_nnb)))
    for sub in field.sousZones:
        subs.append(SousZone(code=f"999${_sub_suffix(sub.code)}", valeur=sub.valeur))
    return Zone(code="999", sousZones=subs, affected_by_curation=workflow_name)


def _remove_workflow_tagged_content(
    intermarc: Intermarc,
    *,
    workflow_name: str,
) -> Intermarc:
    zones: List[Zone] = []
    for zone in intermarc.zones:
        if zone.affected_by_curation == workflow_name:
            continue
        subs = [SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation) for sub in zone.sousZones if sub.affected_by_curation != workflow_name]
        if not subs:
            continue
        zones.append(
            Zone(
                code=zone.code,
                sousZones=subs,
                field_compact_value=zone.field_compact_value,
                affected_by_curation=zone.affected_by_curation,
            )
        )
    return Intermarc(zones=zones)


@dataclass(frozen=True)
class _WorkCtx:
    ark: str
    nnb: int
    record: Intermarc


def _work_ctx(entity) -> _WorkCtx:
    ark = entity.ark() or ""
    return _WorkCtx(ark=ark, nnb=_ark_to_nnb(ark), record=entity.intermarc)


def _replace_tag_group(
    zones: List[Zone],
    *,
    tag: str,
    replacement: Sequence[Zone],
) -> List[Zone]:
    """Replace all occurrences of a tag, preserving overall ordering deterministically."""
    first_idx: Optional[int] = None
    out: List[Zone] = []
    for zone in zones:
        if zone.code != tag:
            out.append(zone)
            continue
        if first_idx is None:
            first_idx = len(out)
        # skip existing tag occurrences
    if first_idx is None:
        return [*out, *replacement]
    return [*out[:first_idx], *replacement, *out[first_idx:]]


def _dedupe_zones_by_exact(zones: Sequence[Zone]) -> List[Zone]:
    seen = set()
    out: List[Zone] = []
    for z in zones:
        k = _exact_key(z)
        if k in seen:
            continue
        seen.add(k)
        out.append(z)
    return out


def _dedupe_by_key_keep_first(zones: Sequence[Zone], key_fn) -> List[Zone]:
    seen = set()
    out: List[Zone] = []
    for z in zones:
        k = key_fn(z)
        if k in seen:
            continue
        seen.add(k)
        out.append(z)
    return out


def _040_q_value(zone: Zone) -> Optional[str]:
    for sub in zone.sousZones:
        if sub.code == "040$q":
            return _norm_ws(sub.valeur) or None
    return None


def _040_multiset(zone: Zone) -> Dict[str, Counter[str]]:
    by_code: Dict[str, Counter[str]] = {}
    for sub in zone.sousZones:
        code = _sub_suffix(sub.code)
        by_code.setdefault(code, Counter())[_norm_ws(sub.valeur)] += 1
    return by_code


def _040_is_subset_and_compatible(smaller: Zone, bigger: Zone) -> bool:
    a = _040_multiset(smaller)
    b = _040_multiset(bigger)
    # overlap must match
    for code, values in a.items():
        if code in b:
            if values != b[code]:
                return False
    # subset by (code,value) pairs
    pairs_a = Counter((c, v) for c, vals in a.items() for v, n in vals.items() for _ in range(n))
    pairs_b = Counter((c, v) for c, vals in b.items() for v, n in vals.items() for _ in range(n))
    return all(pairs_b[pair] >= cnt for pair, cnt in pairs_a.items()) and pairs_a != pairs_b


def _apply_040(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    anchor_040 = [z for z in zones if z.code == "040"]
    anchor_exact = {_exact_key(z) for z in anchor_040}

    by_q: Dict[Optional[str], List[Zone]] = {}
    for m in members:
        for z in m.record.get_zone("040"):
            by_q.setdefault(_040_q_value(z), []).append(_clone_zone(z))

    additions: List[Zone] = []
    for q, group in by_q.items():
        group = _dedupe_zones_by_exact(group)
        # drop partial-compatible subsets (keep most complete)
        group_sorted = sorted(group, key=lambda z: len(z.sousZones), reverse=True)
        kept: List[Zone] = []
        for cand in group_sorted:
            if any(_040_is_subset_and_compatible(cand, k) for k in kept if _040_q_value(k) == q):
                continue
            kept.append(cand)
        # deterministic: stable by original order of group_sorted (already)
        for z in kept:
            if _exact_key(z) in anchor_exact:
                continue
            additions.append(Zone(code="040", sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING))

    if not additions:
        return zones
    return [*zones, *_dedupe_zones_by_exact(additions)]


def _apply_041(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    anchor_041 = [z for z in zones if z.code == "041"]
    anchor_has_041 = bool(anchor_041)
    anchor_exact = {_exact_key(z) for z in anchor_041}

    member_041 = _dedupe_zones_by_exact([_clone_zone(z) for m in members for z in m.record.get_zone("041")])
    if not member_041:
        return zones
    if not anchor_has_041:
        additions = [Zone(code="041", sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING) for z in member_041 if _exact_key(z) not in anchor_exact]
        return [*zones, *_dedupe_zones_by_exact(additions)]
    moved = []
    for z in member_041:
        if _exact_key(z) in anchor_exact:
            continue
        moved.append(_to_999(z, origin_tag="041"))
    return [*zones, *_dedupe_zones_by_exact(moved)]


def _apply_simple_graft(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone], tag: str) -> List[Zone]:
    existing = [z for z in zones if z.code == tag]
    existing_keys = {_exact_key(z) for z in existing}
    additions = []
    for m in members:
        for z in m.record.get_zone(tag):
            key = _exact_key(z)
            if key in existing_keys:
                continue
            additions.append(Zone(code=tag, sousZones=_clone_zone(z).sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING))
            existing_keys.add(key)
    if not additions:
        return zones
    # exact dedupe across combined set (keeps earlier zones)
    combined = _dedupe_zones_by_exact([*zones, *additions])
    return combined


def _apply_150_450(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    anchor_150 = [z for z in zones if z.code == "150"]
    anchor_450 = [z for z in zones if z.code == "450"]
    anchor_150_core = {_core_key_ignoring_let(_clone_zone(z)) for z in anchor_150}

    candidates: List[tuple[Zone, str, Optional[int]]] = []
    # (zone, source_kind, source_nnb)
    for z in anchor_450:
        candidates.append((_clone_zone(z), "anchor", None))
    for m in members:
        for z in m.record.get_zone("450"):
            candidates.append((_clone_zone(z), "member", m.nnb))
        for z in m.record.get_zone("150"):
            candidates.append((_clone_zone(z, new_tag="450"), "member", m.nnb))

    # 4.2 drop 450 duplicating anchor 150 core key
    filtered: List[tuple[Zone, str, Optional[int]]] = []
    for z, source, nnb in candidates:
        core = _core_key_ignoring_let(z)
        if ("150", core[1]) in anchor_150_core:
            continue
        filtered.append((z, source, nnb))

    # 4.3 group by core key (case-sensitive)
    grouped: Dict[tuple[tuple[str, str], ...], List[tuple[Zone, str, Optional[int]]]] = {}
    order: List[tuple[tuple[str, str], ...]] = []
    for z, source, nnb in filtered:
        core_pairs = tuple(
            (_sub_suffix(sz.code), _norm_ws(sz.valeur))
            for sz in z.sousZones
            if _sub_suffix(sz.code) not in {"L", "E", "T"}
        )
        if core_pairs not in grouped:
            order.append(core_pairs)
            grouped[core_pairs] = []
        grouped[core_pairs].append((z, source, nnb))

    chosen: List[Zone] = []
    for core_pairs in order:
        group = grouped[core_pairs]
        # 1) prefer existing on anchor
        anchor_candidates = [item for item in group if item[1] == "anchor"]
        if anchor_candidates:
            pick = anchor_candidates[0][0]
            chosen.append(pick)
            continue
        # 2) most distinct LET
        max_let = max(_let_count(item[0]) for item in group)
        group2 = [item for item in group if _let_count(item[0]) == max_let]
        if len(group2) == 1:
            chosen.append(group2[0][0])
            continue
        # 3) highest NNB if LET values differ
        max_nnb = max(item[2] or 0 for item in group2)
        group3 = [item for item in group2 if (item[2] or 0) == max_nnb]
        chosen.append(group3[0][0])

    # write resolved 450 set back (replace all 450)
    anchor_exact = {_exact_key(z) for z in anchor_450}
    replacement: List[Zone] = []
    for z in _dedupe_zones_by_exact(chosen):
        if _exact_key(z) in anchor_exact:
            # preserve existing anchor zone flags/content by reusing clone from zones
            existing_match = next((orig for orig in anchor_450 if _exact_key(orig) == _exact_key(z)), None)
            replacement.append(_clone_zone(existing_match) if existing_match else _clone_zone(z))
        else:
            replacement.append(Zone(code="450", sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING))

    # remove old 450 and insert resolved
    no_450 = [z for z in zones if z.code != "450"]
    return _replace_tag_group(no_450, tag="450", replacement=replacement)


def _apply_300(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    anchor_300 = [z for z in zones if z.code == "300"]
    anchor_exact = {_exact_key(z) for z in anchor_300}
    moved: List[Zone] = []
    for m in members:
        for z in m.record.get_zone("300"):
            if _exact_key(z) in anchor_exact:
                continue
            moved.append(_to_999(_clone_zone(z), origin_tag="300"))
    if not moved:
        return zones
    return [*zones, *_dedupe_zones_by_exact(moved)]


def _apply_609(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    all_works = [anchor, *members]
    has_any_96x = any(_tag_is_96x(z.code) for w in all_works for z in w.record.zones)
    all_609 = [_clone_zone(z) for w in all_works for z in w.record.get_zone("609")]
    if not all_609:
        return zones
    if not has_any_96x:
        deduped = _dedupe_zones_by_exact(all_609)
        replacement = []
        anchor_exact = {_exact_key(z) for z in zones if z.code == "609"}
        for z in deduped:
            if _exact_key(z) in anchor_exact:
                existing = next((orig for orig in zones if orig.code == "609" and _exact_key(orig) == _exact_key(z)), None)
                replacement.append(_clone_zone(existing) if existing else _clone_zone(z))
            else:
                replacement.append(Zone(code="609", sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING))
        stripped = [z for z in zones if z.code != "609"]
        return _replace_tag_group(stripped, tag="609", replacement=replacement)

    moved = [_to_999(z, origin_tag="609") for z in _dedupe_zones_by_exact(all_609)]
    stripped = [z for z in zones if z.code != "609"]
    return [*stripped, *moved]


def _apply_629_or_62t(
    anchor: _WorkCtx,
    members: List[_WorkCtx],
    zones: List[Zone],
    *,
    tag: str,
) -> List[Zone]:
    if not any(m.record.get_zone(tag) for m in members):
        return zones
    anchor_fields = [z for z in zones if z.code == tag]
    anchor_subs_in_order: List[SousZone] = []
    for z in anchor_fields:
        anchor_subs_in_order.extend([SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation) for sub in z.sousZones])

    seen = {(sub.code, _norm_ws(sub.valeur)) for sub in anchor_subs_in_order}
    ordered: List[SousZone] = [SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation) for sub in anchor_subs_in_order]

    for m in sorted(members, key=lambda w: w.nnb, reverse=True):
        for z in m.record.get_zone(tag):
            for sub in z.sousZones:
                key = (f"{tag}${_sub_suffix(sub.code)}", _norm_ws(sub.valeur))
                if key in seen:
                    continue
                seen.add(key)
                ordered.append(
                    SousZone(
                        code=f"{tag}${_sub_suffix(sub.code)}",
                        valeur=sub.valeur,
                        affected_by_curation=CLUSTER_FIELD_GRAFTING,
                    )
                )

    replacement_zone = None
    if anchor_fields:
        # preserve the first anchor zone metadata; collapse to one zone
        replacement_zone = _clone_zone(anchor_fields[0])
        replacement_zone.sousZones = ordered
    else:
        replacement_zone = Zone(code=tag, sousZones=ordered, affected_by_curation=CLUSTER_FIELD_GRAFTING)

    stripped = [z for z in zones if z.code != tag]
    return _replace_tag_group(stripped, tag=tag, replacement=[replacement_zone])


def _dewey_key_680(zone: Zone) -> Optional[str]:
    parts = []
    for code in ("da", "dg", "di"):
        vals = [_norm_ws(sz.valeur) for sz in zone.sousZones if _sub_suffix(sz.code) == code]
        parts.append("|".join(vals))
    key = "§".join(parts)
    return key if key.strip("§|") else None


def _apply_680(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    anchor_680 = [z for z in zones if z.code == "680"]
    all_works = [anchor, *members]
    works_with_680 = [w for w in all_works if w.record.get_zone("680")]
    if not works_with_680:
        return zones

    moved_to_999: List[Zone] = []
    if anchor_680:
        # keep anchor 680 as-is; members -> 999 (dedupe by Dewey key)
        by_dewey: Dict[Optional[str], tuple[Zone, int]] = {}
        for m in members:
            for z in m.record.get_zone("680"):
                key = _dewey_key_680(z)
                if key in by_dewey:
                    continue
                by_dewey[key] = (_clone_zone(z), m.nnb)
        for z, nnb in by_dewey.values():
            moved_to_999.append(_to_999(z, origin_tag="680", origin_nnb=nnb, add_mmd_nnb=True))
        return [*zones, *_dedupe_zones_by_exact(moved_to_999)]

    # anchor has no 680: pick highest-NNB work with 680 and copy its 680 into anchor
    chosen_work = max(works_with_680, key=lambda w: w.nnb)
    chosen_680 = [_clone_zone(z) for z in chosen_work.record.get_zone("680")]
    inserted_680 = [Zone(code="680", sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING) for z in chosen_680]

    by_dewey: Dict[Optional[str], tuple[Zone, int]] = {}
    for w in works_with_680:
        if w.ark == chosen_work.ark:
            continue
        for z in w.record.get_zone("680"):
            key = _dewey_key_680(z)
            if key in by_dewey:
                continue
            by_dewey[key] = (_clone_zone(z), w.nnb)
    for z, nnb in by_dewey.values():
        moved_to_999.append(_to_999(z, origin_tag="680", origin_nnb=nnb, add_mmd_nnb=True))

    stripped = [z for z in zones if z.code != "680"]
    with_680 = _replace_tag_group(stripped, tag="680", replacement=inserted_680)
    return [*with_680, *_dedupe_zones_by_exact(moved_to_999)]


def _apply_685(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    all_works = [anchor, *members]
    has_any_96x = any(_tag_is_96x(z.code) for w in all_works for z in w.record.zones)
    has_any_609 = any(w.record.get_zone("609") for w in all_works)
    all_685 = [_clone_zone(z) for w in all_works for z in w.record.get_zone("685")]
    if not all_685:
        return zones
    if not (has_any_96x or has_any_609):
        deduped = _dedupe_zones_by_exact(all_685)
        anchor_exact = {_exact_key(z) for z in zones if z.code == "685"}
        replacement = []
        for z in deduped:
            if _exact_key(z) in anchor_exact:
                existing = next((orig for orig in zones if orig.code == "685" and _exact_key(orig) == _exact_key(z)), None)
                replacement.append(_clone_zone(existing) if existing else _clone_zone(z))
            else:
                replacement.append(Zone(code="685", sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING))
        stripped = [z for z in zones if z.code != "685"]
        return _replace_tag_group(stripped, tag="685", replacement=replacement)

    moved = [_to_999(z, origin_tag="685") for z in _dedupe_zones_by_exact(all_685)]
    stripped = [z for z in zones if z.code != "685"]
    return [*stripped, *moved]


def _apply_7xx_merge_by_3(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone], tag: str) -> List[Zone]:
    anchor_fields = [z for z in zones if z.code == tag]

    def key_for_zone(z: Zone) -> tuple[str, Optional[str]]:
        vals = [sz.valeur for sz in z.sousZones if sz.code == f"{tag}$3"]
        if vals:
            return ("3", _norm_ws(vals[0]) or None)
        return ("exact", "|".join(f"{_sub_suffix(sz.code)}={_norm_ws(sz.valeur)}" for sz in z.sousZones))

    groups: Dict[tuple[str, Optional[str]], List[tuple[Zone, Optional[int], str]]] = {}
    # (zone, source_nnb, source_kind)
    for z in anchor_fields:
        groups.setdefault(key_for_zone(z), []).append((_clone_zone(z), None, "anchor"))
    for m in members:
        for z in m.record.get_zone(tag):
            groups.setdefault(key_for_zone(z), []).append((_clone_zone(z), m.nnb, "member"))

    merged: List[Zone] = []
    for group_key, items in groups.items():
        if group_key[0] != "3":
            # no $3: exact dedupe only
            deduped = _dedupe_zones_by_exact([it[0] for it in items])
            merged.extend(deduped)
            continue

        anchor_item = next((it for it in items if it[2] == "anchor"), None)
        if anchor_item:
            base = anchor_item[0]
        else:
            base = max(items, key=lambda it: it[1] or 0)[0]

        existing_pairs = {(sub.code, _norm_ws(sub.valeur)) for sub in base.sousZones}
        next_subs = [SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation) for sub in base.sousZones]
        for z, _, _ in items:
            for sub in z.sousZones:
                pair = (sub.code, _norm_ws(sub.valeur))
                if pair in existing_pairs:
                    continue
                existing_pairs.add(pair)
                next_subs.append(
                    SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=CLUSTER_FIELD_GRAFTING)
                )
        merged.append(Zone(code=tag, sousZones=next_subs, affected_by_curation=base.affected_by_curation))

    stripped = [z for z in zones if z.code != tag]
    return _replace_tag_group(stripped, tag=tag, replacement=merged)


def _apply_860(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    anchor_860 = [z for z in zones if z.code == "860"]
    all_works = [anchor, *members]
    works_with_860 = [w for w in all_works if w.record.get_zone("860")]
    if not works_with_860:
        return zones

    moved: List[Zone] = []
    if anchor_860:
        for m in members:
            moved.extend(_clone_zone(z) for z in m.record.get_zone("860"))
        moved = _dedupe_zones_by_exact(moved)
        return [*zones, *[_to_999(z, origin_tag="860") for z in moved]]

    chosen = max(works_with_860, key=lambda w: w.nnb)
    inserted = [Zone(code="860", sousZones=_clone_zone(z).sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING) for z in chosen.record.get_zone("860")]
    for w in works_with_860:
        if w.ark == chosen.ark:
            continue
        moved.extend(_clone_zone(z) for z in w.record.get_zone("860"))
    moved = _dedupe_zones_by_exact(moved)
    stripped = [z for z in zones if z.code != "860"]
    with_860 = _replace_tag_group(stripped, tag="860", replacement=inserted)
    return [*with_860, *[_to_999(z, origin_tag="860") for z in moved]]


def _apply_968(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    anchor_968 = [z for z in zones if z.code == "968"]
    works_with_968 = [m for m in members if m.record.get_zone("968")]
    works_with_968.sort(key=lambda w: w.nnb, reverse=True)
    keep_members = works_with_968[: (1 if anchor_968 else 2)]
    resulting = []
    resulting.extend(_clone_zone(z) for z in anchor_968)
    for m in keep_members:
        resulting.extend(_clone_zone(z) for z in m.record.get_zone("968"))
    resulting = _dedupe_zones_by_exact(resulting)

    anchor_exact = {_exact_key(z) for z in anchor_968}
    replacement = []
    for z in resulting:
        if _exact_key(z) in anchor_exact:
            existing = next((orig for orig in anchor_968 if _exact_key(orig) == _exact_key(z)), None)
            replacement.append(_clone_zone(existing) if existing else _clone_zone(z))
        else:
            replacement.append(Zone(code="968", sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING))
    stripped = [z for z in zones if z.code != "968"]
    return _replace_tag_group(stripped, tag="968", replacement=replacement)


def _apply_96x(anchor: _WorkCtx, members: List[_WorkCtx], zones: List[Zone]) -> List[Zone]:
    all_works = [anchor, *members]
    works_with_96x = [w for w in all_works if any(_tag_is_96x_excluding_968(z.code) for z in w.record.zones)]
    k = len(works_with_96x)
    if k == 0:
        return zones

    # Extract unique chains per work.
    chains_by_work: Dict[str, Dict[tuple, Zone]] = {}
    for w in works_with_96x:
        seen = {}
        for z in w.record.zones:
            if not _tag_is_96x_excluding_968(z.code):
                continue
            key = _chain_key_96x(z)
            if key in seen:
                continue
            seen[key] = _clone_zone(z)
        chains_by_work[w.ark] = seen

    kept: List[Zone] = []
    moved: List[Zone] = []

    if k > 3:
        freq: Counter[tuple] = Counter()
        exemplar: Dict[tuple, Zone] = {}
        for w in works_with_96x:
            for key, z in chains_by_work[w.ark].items():
                freq[key] += 1
                exemplar.setdefault(key, z)
        for key, count in freq.items():
            z = exemplar[key]
            if count > 3:
                kept.append(z)
            else:
                moved.append(_to_999(z, origin_tag=z.code))
        kept.sort(key=lambda z: (-freq[_chain_key_96x(z)], z.code, str(_exact_key(z))))
        moved.sort(key=lambda z: (z.sousZones[1].valeur if z.sousZones else "", str(_exact_key(z))))
    else:
        # traverse works descending NNB, within record order
        ordered_works = sorted(works_with_96x, key=lambda w: w.nnb, reverse=True)
        seen_keys = set()
        ordered_keys: List[tuple] = []
        exemplar: Dict[tuple, Zone] = {}
        for w in ordered_works:
            for z in w.record.zones:
                if not _tag_is_96x_excluding_968(z.code):
                    continue
                key = _chain_key_96x(z)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                ordered_keys.append(key)
                exemplar[key] = _clone_zone(z)
        keep_keys = set(ordered_keys[:3])
        for key in ordered_keys:
            z = exemplar[key]
            if key in keep_keys:
                kept.append(z)
            else:
                moved.append(_to_999(z, origin_tag=z.code))

    # Replace anchor 96X≠968 with kept; keep anchor originals when possible.
    anchor_existing = [z for z in zones if _tag_is_96x_excluding_968(z.code)]
    anchor_map = { _chain_key_96x(z): z for z in anchor_existing }
    replacement = []
    for z in _dedupe_by_key_keep_first(kept, _chain_key_96x):
        kkey = _chain_key_96x(z)
        if kkey in anchor_map:
            replacement.append(_clone_zone(anchor_map[kkey]))
        else:
            replacement.append(Zone(code=z.code, sousZones=z.sousZones, affected_by_curation=CLUSTER_FIELD_GRAFTING))

    stripped = [z for z in zones if not _tag_is_96x_excluding_968(z.code)]
    # insert all kept 96X at end (deterministic), then moved-to-999 at end
    return [*stripped, *replacement, *_dedupe_zones_by_exact(moved)]


SIMPLE_GRAFT_TAGS = {
    "016",
    "39A",
    "043",
    "057",
    "073",
    "075",
    "076",
    "304",
    "350",
    "501",
    "552",
    "558",
    "628",
    "644",
    "681",
    "682",
    "683",
    "686",
    "02A",
    "02V",
    "30P",
    "35S",
    "55P",
    "62A",
    "62G",
    "62I",
    "62L",
}


RESPONSIBILITY_TAGS = ("700", "701", "702", "710", "711")


class WorkClusterFieldGraftingWorkflow:
    name = CLUSTER_FIELD_GRAFTING

    def apply(self, anchor: ClusterAnchorContext, members: List) -> Intermarc:
        anchor_ctx = _work_ctx(anchor.entity)
        member_ctxs = [_work_ctx(m) for m in members]
        member_ctxs = [m for m in member_ctxs if m.ark and m.ark != anchor_ctx.ark]

        zones = [_clone_zone(z) for z in anchor_ctx.record.zones]

        for tag in sorted(SIMPLE_GRAFT_TAGS):
            zones = _apply_simple_graft(anchor_ctx, member_ctxs, zones, tag)

        zones = _apply_040(anchor_ctx, member_ctxs, zones)
        zones = _apply_041(anchor_ctx, member_ctxs, zones)
        zones = _apply_150_450(anchor_ctx, member_ctxs, zones)
        zones = _apply_300(anchor_ctx, member_ctxs, zones)
        zones = _apply_609(anchor_ctx, member_ctxs, zones)
        zones = _apply_629_or_62t(anchor_ctx, member_ctxs, zones, tag="629")
        zones = _apply_680(anchor_ctx, member_ctxs, zones)
        zones = _apply_685(anchor_ctx, member_ctxs, zones)
        for tag in RESPONSIBILITY_TAGS:
            zones = _apply_7xx_merge_by_3(anchor_ctx, member_ctxs, zones, tag)
        zones = _apply_860(anchor_ctx, member_ctxs, zones)
        zones = _apply_968(anchor_ctx, member_ctxs, zones)
        zones = _apply_629_or_62t(anchor_ctx, member_ctxs, zones, tag="62T")
        zones = _apply_96x(anchor_ctx, member_ctxs, zones)

        return Intermarc(zones=zones)

    def remove(self, anchor_intermarc: Intermarc) -> Intermarc:
        return _remove_workflow_tagged_content(anchor_intermarc, workflow_name=self.name)
