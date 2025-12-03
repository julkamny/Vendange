from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class MediaKind(BaseModel):
    kind_code: str = Field(..., description="Normalized media code (accent-free, lower-case).")
    emoji: str
    label: str


class RelationshipStats(BaseModel):
    outgoing: int = 0
    incoming: int = 0


class CountStats(BaseModel):
    expressions: int = 0
    manifestations: int = 0


class EntitySummary(BaseModel):
    counts: Optional[CountStats] = None
    relationships: Optional[RelationshipStats] = None
    media_kinds: List[MediaKind] = Field(default_factory=list)


class TitleSegment(BaseModel):
    code: str
    label: str
    value: str
    ark: Optional[str] = None


class ManifestationItemView(BaseModel):
    id: str
    ark: Optional[str] = None
    title: Optional[str] = None
    expression_ark: Optional[str] = None
    expression_id: Optional[str] = None
    original_expression_ark: Optional[str] = None
    summary: Optional[EntitySummary] = None


class ExpressionItemView(BaseModel):
    id: str
    ark: Optional[str] = None
    title: Optional[str] = None
    work_ark: Optional[str] = None
    work_id: Optional[str] = None
    manifestations: List[ManifestationItemView] = Field(default_factory=list)
    summary: Optional[EntitySummary] = None


class ExpressionClusterItemView(ExpressionItemView):
    anchor_expression_id: str
    accepted: bool = True
    date: Optional[str] = None
    origin: str = "script"


class ExpressionAnchorGroupView(BaseModel):
    anchor: ExpressionItemView
    clustered: List[ExpressionClusterItemView] = Field(default_factory=list)


class WorkClusterItem(BaseModel):
    ark: str
    id: Optional[str] = None
    title: Optional[str] = None
    title_segments: List[TitleSegment] = Field(default_factory=list)
    accepted: bool = True
    date: Optional[str] = None
    origin: str = "script"
    summary: Optional[EntitySummary] = None


class WorkCluster(BaseModel):
    anchor_id: str
    anchor_ark: Optional[str] = None
    anchor_title: Optional[str] = None
    anchor_title_segments: List[TitleSegment] = Field(default_factory=list)
    anchor_summary: Optional[EntitySummary] = None
    items: List[WorkClusterItem] = Field(default_factory=list)
    expression_groups: List[ExpressionAnchorGroupView] = Field(default_factory=list)
    independent_expressions: List[ExpressionItemView] = Field(default_factory=list)


class WorkListRow(BaseModel):
    id: str
    ark: Optional[str] = None
    title: Optional[str] = None
    title_segments: List[TitleSegment] = Field(default_factory=list)
    type_norm: str
    summary: Optional[EntitySummary] = None


class AgentClusterItem(BaseModel):
    ark: str
    id: Optional[str] = None
    label: Optional[str] = None
    origin: Optional[str] = None
    date: Optional[str] = None
    type_norm: Optional[str] = None
    accepted: bool = True
    title_segments: List[TitleSegment] = Field(default_factory=list)
    sort_key: Optional[str] = None


class AgentCluster(BaseModel):
    anchor_id: str
    anchor_ark: Optional[str] = None
    anchor_label: Optional[str] = None
    anchor_type_norm: Optional[str] = None
    anchor_title_segments: List[TitleSegment] = Field(default_factory=list)
    sort_key: Optional[str] = None
    items: List[AgentClusterItem] = Field(default_factory=list)


class AgentListRow(BaseModel):
    id: str
    ark: Optional[str] = None
    label: Optional[str] = None
    type_norm: str
    title_segments: List[TitleSegment] = Field(default_factory=list)
    sort_key: Optional[str] = None


class WorkspaceWorksResponse(BaseModel):
    clusters: List[WorkCluster] = Field(default_factory=list)
    unclustered_works: List[WorkListRow] = Field(default_factory=list)


class WorkspaceAgentsResponse(BaseModel):
    clusters: List[AgentCluster] = Field(default_factory=list)
    unclustered_agents: List[AgentListRow] = Field(default_factory=list)


class RecordPayload(BaseModel):
    id: str
    type: str
    ark: Optional[str] = None
    intermarc: str
    ark_labels: Dict[str, str] = Field(default_factory=dict)


class BacklinkItem(BaseModel):
    id: str
    ark: Optional[str] = None
    type: str
    type_norm: Optional[str] = None
    title: Optional[str] = None
    title_segments: List[TitleSegment] = Field(default_factory=list)
    fields: List[str] = Field(default_factory=list)


class BacklinksPayload(BaseModel):
    target_id: str
    target_ark: Optional[str] = None
    backlinks: List[BacklinkItem] = Field(default_factory=list)
