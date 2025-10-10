from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import json

from scripts.utils.title_cleaner import normalize_title_for_clustering


@dataclass
class SousZone:
    code: str
    valeur: str


@dataclass
class Zone:
    code: str
    sousZones: List[SousZone] = field(default_factory=list)

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Zone":
        return Zone(
            code=d.get("code", ""),
            sousZones=[SousZone(code=sz.get("code", ""), valeur=str(sz.get("valeur", ""))) for sz in d.get("sousZones", [])],
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "sousZones": [{"code": sz.code, "valeur": sz.valeur} for sz in self.sousZones],
        }

    def subfield_values(self, sub_code: str) -> List[str]:
        """Return values for sousZones matching exact sub_code like '150$a' or '90F$q'."""
        return [sz.valeur for sz in self.sousZones if sz.code == sub_code]


@dataclass
class Intermarc:
    zones: List[Zone] = field(default_factory=list)

    @staticmethod
    def from_json_string(s: str) -> "Intermarc":
        data = json.loads(s)
        zones = [Zone.from_dict(z) for z in data.get("zones", [])]
        return Intermarc(zones=zones)

    def to_json_string(self) -> str:
        data = {"zones": [z.to_dict() for z in self.zones]}
        return json.dumps(data, ensure_ascii=False)

    def get_zone(self, code: str) -> List[Zone]:
        return [z for z in self.zones if z.code == code]

    def get_subfield_values(self, zone_code: str, sub_letter: str) -> List[str]:
        pattern = f"{zone_code}${sub_letter}"
        vals: List[str] = []
        for z in self.get_zone(zone_code):
            vals.extend(z.subfield_values(pattern))
        return vals

    def add_zone(self, zone: Zone) -> None:
        self.zones.append(zone)


@dataclass
class Entity:
    id_entitelrm: str
    type_entite: str
    intermarc_raw: str
    intermarc: Intermarc = field(init=False)

    def __post_init__(self) -> None:
        self.intermarc = Intermarc.from_json_string(self.intermarc_raw)

    def ark(self) -> Optional[str]:
        vals = self.intermarc.get_subfield_values("001", "a")
        return vals[0] if vals else None

    def work_group_key(self) -> Optional[Tuple[str, str]]:
        """For works: (015$c, 700$3). Return None if either missing."""
        c015 = self.intermarc.get_subfield_values("015", "c")
        c700_3 = self.intermarc.get_subfield_values("700", "3")
        if not c015 or not c700_3:
            return None
        return (c015[0], c700_3[0])

    def title_main(self) -> Optional[str]:
        vals = self.intermarc.get_subfield_values("150", "a")
        return vals[0] if vals else None

    def normalized_base_title(self) -> Optional[str]:
        normalized = getattr(self, "_normalized_title_for_cluster", None)
        if normalized:
            return normalized or None

        candidate = self.title_main()
        if not candidate:
            return None
        normalized = normalize_title_for_clustering(candidate)
        return normalized or None

    def clone_with_new_intermarc(self, new_intermarc: Intermarc) -> "Entity":
        e = Entity(self.id_entitelrm, self.type_entite, new_intermarc.to_json_string())
        return e
