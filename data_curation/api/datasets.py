from __future__ import annotations

import json
import re
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

DATASETS_ROOT = Path(__file__).resolve().parent / "datasets"
METADATA_PATH = DATASETS_ROOT / "datasets.json"
_METADATA_LOCK = threading.RLock()


@dataclass
class DatasetMetadata:
    id: str
    title: str
    created_at: str
    updated_at: str
    source_filename: Optional[str] = None
    last_clustered_at: Optional[str] = None

    def to_dict(self) -> Dict[str, str | None]:
        data = asdict(self)
        return data


def ensure_root() -> None:
    DATASETS_ROOT.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[\s_-]+", "-", value)
    value = value.strip("-")
    return value or "dataset"


def _load_metadata_unlocked() -> Dict[str, DatasetMetadata]:
    if not METADATA_PATH.exists():
        return {}
    data = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    lookup: Dict[str, DatasetMetadata] = {}
    for item in data:
        meta = DatasetMetadata(
            id=item["id"],
            title=item["title"],
            created_at=item["created_at"],
            updated_at=item["updated_at"],
            source_filename=item.get("source_filename"),
            last_clustered_at=item.get("last_clustered_at"),
        )
        lookup[meta.id] = meta
    return lookup


def _save_metadata_unlocked(metadata: Iterable[DatasetMetadata]) -> None:
    payload = [m.to_dict() for m in metadata]
    METADATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def list_datasets() -> List[DatasetMetadata]:
    with _METADATA_LOCK:
        ensure_root()
        return list(_load_metadata_unlocked().values())


def get_dataset(dataset_id: str) -> DatasetMetadata:
    with _METADATA_LOCK:
        ensure_root()
        data = _load_metadata_unlocked()
        if dataset_id not in data:
            raise KeyError(f"Dataset not found: {dataset_id}")
        return data[dataset_id]


def _generate_dataset_id(title: Optional[str], existing: Dict[str, DatasetMetadata]) -> str:
    base = _slugify(title or "dataset")
    candidate = base
    suffix = 1
    while candidate in existing:
        suffix += 1
        candidate = f"{base}-{suffix}"
        if suffix > 5:
            candidate = f"{base}-{uuid.uuid4().hex[:8]}"
            break
    return candidate


def create_dataset_entry(title: Optional[str], source_filename: Optional[str]) -> DatasetMetadata:
    with _METADATA_LOCK:
        ensure_root()
        data = _load_metadata_unlocked()
        dataset_id = _generate_dataset_id(title, data)
        now = _now_iso()
        meta = DatasetMetadata(
            id=dataset_id,
            title=title.strip() if title else dataset_id,
            created_at=now,
            updated_at=now,
            source_filename=source_filename,
            last_clustered_at=None,
        )
        data[dataset_id] = meta
        _save_metadata_unlocked(data.values())
    dataset_path = dataset_directory(dataset_id)
    dataset_path.mkdir(parents=True, exist_ok=True)
    return meta


def ensure_dataset(dataset_id: str, title: Optional[str] = None, source_filename: Optional[str] = None) -> DatasetMetadata:
    normalized_id = _slugify(dataset_id)
    with _METADATA_LOCK:
        ensure_root()
        data = _load_metadata_unlocked()
        if normalized_id in data:
            return data[normalized_id]
        now = _now_iso()
        meta = DatasetMetadata(
            id=normalized_id,
            title=title.strip() if title else normalized_id,
            created_at=now,
            updated_at=now,
            source_filename=source_filename,
            last_clustered_at=None,
        )
        data[normalized_id] = meta
        _save_metadata_unlocked(data.values())
    dataset_directory(normalized_id).mkdir(parents=True, exist_ok=True)
    return meta


def update_dataset_title(dataset_id: str, title: str) -> DatasetMetadata:
    with _METADATA_LOCK:
        ensure_root()
        data = _load_metadata_unlocked()
        if dataset_id not in data:
            raise KeyError(f"Dataset not found: {dataset_id}")
        meta = data[dataset_id]
        meta.title = title.strip() or meta.title
        meta.updated_at = _now_iso()
        data[dataset_id] = meta
        _save_metadata_unlocked(data.values())
        return meta


def touch_dataset(dataset_id: str) -> None:
    with _METADATA_LOCK:
        ensure_root()
        data = _load_metadata_unlocked()
        if dataset_id not in data:
            return
        meta = data[dataset_id]
        meta.updated_at = _now_iso()
        data[dataset_id] = meta
        _save_metadata_unlocked(data.values())


def delete_dataset_entry(dataset_id: str) -> None:
    with _METADATA_LOCK:
        ensure_root()
        data = _load_metadata_unlocked()
        if dataset_id in data:
            data.pop(dataset_id)
            _save_metadata_unlocked(data.values())


def dataset_directory(dataset_id: str) -> Path:
    return DATASETS_ROOT / dataset_id


def mark_clustered(dataset_id: str) -> None:
    with _METADATA_LOCK:
        ensure_root()
        data = _load_metadata_unlocked()
        if dataset_id not in data:
            return
        meta = data[dataset_id]
        timestamp = _now_iso()
        meta.last_clustered_at = timestamp
        meta.updated_at = timestamp
        data[dataset_id] = meta
        _save_metadata_unlocked(data.values())
