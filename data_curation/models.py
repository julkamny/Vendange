from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import json

from data_curation.utils.title_cleaner import normalize_title_for_clustering


RESPONSIBILITY_ZONE_CODES = ("700", "701", "702", "710", "711", "712")


@dataclass(frozen=True)
class AgentResponsibility:
    """Representation of a responsibility agent attached to a work."""

    zone_code: str
    ark: str
    relator: Optional[str] = None


@dataclass(frozen=True)
class WorkGroupKey:
    """Key grouping works by the shared authority (015$c) and their agents."""

    base_identifier: str
    agents: Tuple[AgentResponsibility, ...]


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

    def work_agents(self) -> List[AgentResponsibility]:
        """Return all responsibility agents declared in 7XX fields."""

        agents: List[AgentResponsibility] = []
        for zone_code in RESPONSIBILITY_ZONE_CODES:
            for zone in self.intermarc.get_zone(zone_code):
                ark = next((sz.valeur for sz in zone.sousZones if sz.code == f"{zone_code}$3"), None)
                if not ark:
                    continue
                relator = next((sz.valeur for sz in zone.sousZones if sz.code == f"{zone_code}$4"), None)
                agents.append(AgentResponsibility(zone_code=zone_code, ark=ark, relator=relator or None))
        return agents

    def work_group_key(self) -> Optional[WorkGroupKey]:
        """For works: provide 015$c alongside every declared agent."""

        c015 = self.intermarc.get_subfield_values("015", "c")
        agents = self.work_agents()
        if not c015 or not agents:
            return None
        return WorkGroupKey(base_identifier=c015[0], agents=tuple(agents))

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
