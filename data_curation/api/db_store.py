from __future__ import annotations

import shutil
import threading
from pathlib import Path

from pyoxigraph import DefaultGraph, NamedNode, Store

from . import datasets
from .db_shared import PROP_ARK, record_graph, record_id_from_subject, record_iri

_STORE_LOCK = threading.RLock()
_STORE_CACHE: dict[str, Store] = {}


def initialize_storage() -> None:
    datasets.ensure_root()


def dataset_store_path(dataset_id: str) -> Path:
    return datasets.dataset_directory(dataset_id)


def close_dataset(dataset_id: str) -> None:
    with _STORE_LOCK:
        store = _STORE_CACHE.pop(dataset_id, None)
        if store is not None:
            store.flush()


def get_store_locked(dataset_id: str) -> Store:
    store = _STORE_CACHE.get(dataset_id)
    if store is None:
        path = dataset_store_path(dataset_id)
        path.mkdir(parents=True, exist_ok=True)
        store = Store(str(path))
        _STORE_CACHE[dataset_id] = store
    return store


def reset_dataset_store(dataset_id: str) -> None:
    close_dataset(dataset_id)
    path = dataset_store_path(dataset_id)
    if path.exists():
        for child in path.iterdir():
            if child.name == "logs":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    else:
        path.mkdir(parents=True, exist_ok=True)


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        if child.is_file() and "logs" not in child.parts:
            total += child.stat().st_size
    return total


def load_ark_index(store: Store) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for quad in store.quads_for_pattern(None, PROP_ARK, None, None):
        if isinstance(quad.subject, NamedNode) and hasattr(quad.object, "value"):
            mapping[quad.object.value] = record_id_from_subject(quad.subject.value)
    return mapping


def clear_record_graph(store: Store, record_id: str) -> None:
    subject = record_iri(record_id)
    graph = record_graph(record_id)
    existing_default = list(store.quads_for_pattern(subject, None, None, None))
    for quad in existing_default:
        graph_name = getattr(quad, "graph_name", None)
        if graph_name is None or isinstance(graph_name, DefaultGraph):
            store.remove(quad)
    store.clear_graph(graph)
