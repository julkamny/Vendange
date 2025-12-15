-- Base schema for Postgres migration (P1, Chunk 03)
-- Partitioned by dataset_id to isolate workloads and indexes.

CREATE TABLE IF NOT EXISTS dataset (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    source_filename text,
    last_clustered_at timestamptz
);

ALTER TABLE dataset ADD COLUMN IF NOT EXISTS source_filename text;
ALTER TABLE dataset ADD COLUMN IF NOT EXISTS last_clustered_at timestamptz;

CREATE TABLE IF NOT EXISTS entity (
    dataset_id  text NOT NULL,
    entity_id   bigserial,
    record_id   text,
    ark         text,
    type_raw    text,
    type_norm   text NOT NULL,
    record      jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset_id, entity_id)
) PARTITION BY LIST (dataset_id);

ALTER TABLE entity ADD COLUMN IF NOT EXISTS record_id text;
ALTER TABLE entity ADD COLUMN IF NOT EXISTS type_raw text;

CREATE INDEX IF NOT EXISTS idx_entity_ark ON entity (ark);
CREATE INDEX IF NOT EXISTS idx_entity_record_id ON entity (record_id);
CREATE INDEX IF NOT EXISTS idx_entity_type_norm ON entity (type_norm);
CREATE INDEX IF NOT EXISTS idx_entity_record_gin ON entity USING GIN (record jsonb_path_ops);

CREATE TABLE IF NOT EXISTS rel_edge (
    dataset_id     text NOT NULL,
    src_entity_id  bigint NOT NULL,
    predicate_iri  text NOT NULL,
    tgt_ark        text DEFAULT '' NOT NULL,
    tgt_entity_id  bigint,
    PRIMARY KEY (dataset_id, src_entity_id, predicate_iri, tgt_ark)
) PARTITION BY LIST (dataset_id);

CREATE INDEX IF NOT EXISTS idx_rel_edge_src ON rel_edge (src_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_edge_tgt_id ON rel_edge (tgt_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_edge_tgt_ark ON rel_edge (tgt_ark);

CREATE TABLE IF NOT EXISTS entity_label (
    dataset_id  text NOT NULL,
    entity_id   bigint NOT NULL,
    label       text NOT NULL,
    sort_key    text,
    type_norm   text,
    PRIMARY KEY (dataset_id, entity_id)
) PARTITION BY LIST (dataset_id);

CREATE INDEX IF NOT EXISTS idx_entity_label_label ON entity_label (label);
CREATE INDEX IF NOT EXISTS idx_entity_label_sort_key ON entity_label (sort_key);

CREATE TABLE IF NOT EXISTS cluster (
    dataset_id        text NOT NULL,
    anchor_entity_id  bigint,
    anchor_ark        text NOT NULL,
    member_entity_id  bigint,
    member_ark        text NOT NULL,
    note              text,
    PRIMARY KEY (dataset_id, anchor_ark, member_ark)
) PARTITION BY LIST (dataset_id);

CREATE INDEX IF NOT EXISTS idx_cluster_member ON cluster (member_ark);

CREATE TABLE IF NOT EXISTS fts (
    dataset_id  text NOT NULL,
    entity_id   bigint NOT NULL,
    document    tsvector NOT NULL,
    PRIMARY KEY (dataset_id, entity_id)
) PARTITION BY LIST (dataset_id);

CREATE INDEX IF NOT EXISTS idx_fts_doc ON fts USING GIN (document);
