from __future__ import annotations

import re
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from data_curation.api.pg import datasets_repo

DATASETS_ROOT = Path(__file__).resolve().parent / "datasets"
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


@dataclass
class DatasetLogBundle:
    run_id: str
    directory: Path
    text_path: Path
    html_path: Path
    assets_path: Path


def ensure_root() -> None:
    DATASETS_ROOT.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_or_none(value: object) -> Optional[str]:
    """Return ISO 8601 string for datetimes; otherwise None."""
    if isinstance(value, datetime):
        return value.isoformat()
    return None


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[\s_-]+", "-", value)
    value = value.strip("-")
    return value or "dataset"


def _load_metadata_unlocked() -> Dict[str, DatasetMetadata]:
    raise NotImplementedError("Legacy metadata file no longer used")


def _save_metadata_unlocked(metadata: Iterable[DatasetMetadata]) -> None:
    raise NotImplementedError("Legacy metadata file no longer used")


def list_datasets() -> List[DatasetMetadata]:
    ensure_root()
    rows = datasets_repo.list_datasets()
    return [
        DatasetMetadata(
            id=row["id"],
            title=row["title"],
            created_at=row["created_at"].isoformat(),
            updated_at=row["updated_at"].isoformat(),
            source_filename=row.get("source_filename"),
            last_clustered_at=_iso_or_none(row.get("last_clustered_at")),
        )
        for row in rows
    ]


def get_dataset(dataset_id: str) -> DatasetMetadata:
    ensure_root()
    row = datasets_repo.get_dataset(dataset_id)
    return DatasetMetadata(
        id=row["id"],
        title=row["title"],
        created_at=row["created_at"].isoformat(),
        updated_at=row["updated_at"].isoformat(),
        source_filename=row.get("source_filename"),
        last_clustered_at=_iso_or_none(row.get("last_clustered_at")),
    )


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
        existing = {meta["id"]: meta for meta in datasets_repo.list_datasets()}
        dataset_id = _generate_dataset_id(title, {k: DatasetMetadata(k, "", "", "") for k in existing})
        datasets_repo.create_dataset(dataset_id, title.strip() if title else dataset_id, source_filename)
    dataset_path = dataset_directory(dataset_id)
    dataset_path.mkdir(parents=True, exist_ok=True)
    return get_dataset(dataset_id)


def ensure_dataset(dataset_id: str, title: Optional[str] = None, source_filename: Optional[str] = None) -> DatasetMetadata:
    normalized_id = _slugify(dataset_id)
    with _METADATA_LOCK:
        ensure_root()
        try:
            return get_dataset(normalized_id)
        except KeyError:
            datasets_repo.create_dataset(normalized_id, title.strip() if title else normalized_id, source_filename)
    dataset_directory(normalized_id).mkdir(parents=True, exist_ok=True)
    return get_dataset(normalized_id)


def update_dataset_title(dataset_id: str, title: str) -> DatasetMetadata:
    with _METADATA_LOCK:
        ensure_root()
        datasets_repo.update_title(dataset_id, title.strip() or title)
    return get_dataset(dataset_id)


def touch_dataset(dataset_id: str) -> None:
    ensure_root()
    datasets_repo.touch(dataset_id)


def delete_dataset_entry(dataset_id: str) -> None:
    ensure_root()
    datasets_repo.delete_dataset(dataset_id)


def dataset_directory(dataset_id: str) -> Path:
    return DATASETS_ROOT / dataset_id


def dataset_logs_directory(dataset_id: str) -> Path:
    directory = dataset_directory(dataset_id) / "logs"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def create_dataset_log_bundle(dataset_id: str, prefix: str = "cluster") -> DatasetLogBundle:
    logs_dir = dataset_logs_directory(dataset_id)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    run_id = f"{prefix}_{timestamp}"
    run_dir = logs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = run_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    text_path = run_dir / "run.log"
    html_path = run_dir / "run.html"
    return DatasetLogBundle(run_id=run_id, directory=run_dir, text_path=text_path, html_path=html_path, assets_path=assets_dir)


def _bundle_from_directory(directory: Path) -> Optional[DatasetLogBundle]:
    if not directory.exists() or not directory.is_dir():
        return None
    run_id = directory.name
    text_path = directory / "run.log"
    html_path = directory / "run.html"
    assets_dir = directory / "assets"
    if not text_path.exists() and not html_path.exists():
        return None
    if not assets_dir.exists():
        assets_dir.mkdir(parents=True, exist_ok=True)
    return DatasetLogBundle(run_id=run_id, directory=directory, text_path=text_path, html_path=html_path, assets_path=assets_dir)


def list_dataset_log_bundles(dataset_id: str, prefix: Optional[str] = None) -> List[DatasetLogBundle]:
    logs_dir = dataset_logs_directory(dataset_id)
    if not logs_dir.exists():
        return []
    bundles: List[DatasetLogBundle] = []
    for entry in sorted(logs_dir.iterdir()):
        if not entry.is_dir():
            continue
        if prefix and not entry.name.startswith(f"{prefix}_"):
            continue
        bundle = _bundle_from_directory(entry)
        if bundle:
            bundles.append(bundle)
    return bundles


def latest_dataset_log_bundle(dataset_id: str, prefix: Optional[str] = None) -> Optional[DatasetLogBundle]:
    bundles = list_dataset_log_bundles(dataset_id, prefix=prefix)
    return bundles[-1] if bundles else None


def load_dataset_log_bundle(dataset_id: str, run_id: str) -> DatasetLogBundle:
    directory = dataset_logs_directory(dataset_id) / run_id
    bundle = _bundle_from_directory(directory)
    if not bundle:
        raise FileNotFoundError(f"Log bundle not found: {run_id}")
    return bundle


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
