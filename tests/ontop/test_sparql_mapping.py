from __future__ import annotations

import re
from typing import Callable

import httpx


def _entity_iri(dataset_id: str, entity_id: int) -> str:
    return f"https://vendange.bnf.fr/entity/{dataset_id}/{entity_id}"


def _run_select(endpoint_url: str, query: str, *, timeout_s: int = 60) -> tuple[list[str], list[list[str | None]]]:
    resp = httpx.post(
        endpoint_url,
        data={"query": query},
        headers={"Accept": "application/sparql-results+json"},
        timeout=timeout_s,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Ontop error {resp.status_code}: {resp.text}\nQuery:\n{query}")
    payload = resp.json()
    cols = payload.get("head", {}).get("vars", [])
    rows = []
    for binding in payload.get("results", {}).get("bindings", []):
        row: list[str | None] = []
        for col in cols:
            cell = binding.get(col)
            row.append(cell.get("value") if cell else None)
        rows.append(row)
    return cols, rows


def _single_value(rows: list[list[str | None]]) -> str:
    assert len(rows) == 1
    assert len(rows[0]) == 1
    assert rows[0][0] is not None
    return rows[0][0]


PREFIXES = "\n".join(
    [
        "PREFIX vend: <https://vendange.bnf.fr/>",
        "PREFIX vendclass: <https://vendange.bnf.fr/class/>",
        "PREFIX vendrel: <https://vendange.bnf.fr/relation/>",
        "PREFIX vendprop: <https://vendange.bnf.fr/property/>",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>",
        "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
    ]
)

_REGEX_META = re.compile(r"([\\\\.^$|?*+()\\[\\]{}])")


def _sparql_regex_escape(value: str) -> str:
    value = value.replace("\\", "\\\\").replace('"', '\\"')
    return _REGEX_META.sub(r"\\\\\\1", value)


def test_counts_match_postgres(ontop_endpoint, ontop_dataset_id, pg_conn, inject: Callable[[str, str], str]):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    for type_norm, cls in [
        ("oeuvre", "vendclass:Work"),
        ("expression", "vendclass:Expression"),
        ("manifestation", "vendclass:Manifestation"),
    ]:
        expected = pg_conn.execute(
            "SELECT count(*) AS c FROM entity_label WHERE dataset_id=%s AND type_norm=%s",
            (ds, type_norm),
        ).fetchone()["c"]

        query = f"""{PREFIXES}
SELECT (COUNT(DISTINCT ?e) AS ?c) WHERE {{
  ?e a {cls} .
}}
"""
        cols, rows = _run_select(endpoint, inject(query, ds), timeout_s=60)
        assert cols == ["c"]
        assert int(_single_value(rows)) == expected


def test_dataset_scoping_isolation(ontop_endpoint, ontop_dataset_id, tiny_dataset_id, pg_conn, inject):
    endpoint = ontop_endpoint.sparql_url
    ds_a = ontop_dataset_id
    ds_b = tiny_dataset_id

    query = f"""{PREFIXES}
SELECT (COUNT(DISTINCT ?w) AS ?c) WHERE {{
  ?w a vendclass:Work .
}}
"""
    expected_a = pg_conn.execute(
        "SELECT count(*) AS c FROM entity_label WHERE dataset_id=%s AND type_norm='oeuvre'",
        (ds_a,),
    ).fetchone()["c"]
    expected_b = pg_conn.execute(
        "SELECT count(*) AS c FROM entity_label WHERE dataset_id=%s AND type_norm='oeuvre'",
        (ds_b,),
    ).fetchone()["c"]
    _, rows_a = _run_select(endpoint, inject(query, ds_a), timeout_s=60)
    _, rows_b = _run_select(endpoint, inject(query, ds_b), timeout_s=60)
    assert int(_single_value(rows_a)) == expected_a
    assert int(_single_value(rows_b)) == expected_b


def test_entity_properties_match_postgres(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    row = pg_conn.execute(
        """
        SELECT el.entity_id, el.label, COALESCE(e.ark,'') AS ark
        FROM entity_label el
        JOIN entity e ON (e.dataset_id=el.dataset_id AND e.entity_id=el.entity_id)
        WHERE el.dataset_id=%s
        ORDER BY el.entity_id
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    iri = _entity_iri(ds, row["entity_id"])

    query = f"""{PREFIXES}
SELECT ?label ?ark WHERE {{
  VALUES (?e) {{ (<{iri}>) }}
  ?e rdfs:label ?label .
  ?e vendprop:ark ?ark .
}}
"""
    cols, rows = _run_select(endpoint, inject(query, ds), timeout_s=60)
    assert cols == ["label", "ark"]
    assert rows == [[row["label"], row["ark"]]]


def test_title_rewrite_work_150a(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    """Exercise the "query by entity title" feature (work titles via 150$a/150$u)."""
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    sample = pg_conn.execute(
        """
        SELECT el.entity_id, sf.value AS title
        FROM entity_label el
        JOIN v_field f ON (f.dataset_id=el.dataset_id AND f.entity_id=el.entity_id)
        JOIN v_subfield sf ON (sf.dataset_id=el.dataset_id AND sf.entity_id=el.entity_id AND sf.field_idx=f.field_idx)
        WHERE el.dataset_id=%s
          AND el.type_norm='oeuvre'
          AND f.tag='150'
          AND sf.code='150$a'
          AND sf.value <> ''
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    assert sample
    token = re.sub(r"\\s+", " ", str(sample["title"]).strip())
    token = token[:12].strip() or token
    token_re = _sparql_regex_escape(token)
    entity_id = sample["entity_id"]
    iri = _entity_iri(ds, entity_id)

    ok = pg_conn.execute(
        """
        SELECT EXISTS(
          SELECT 1
          FROM v_field f
          JOIN v_subfield sf ON (sf.dataset_id=f.dataset_id AND sf.entity_id=f.entity_id AND sf.field_idx=f.field_idx)
          WHERE f.dataset_id=%s
            AND f.entity_id=%s
            AND f.tag='150'
            AND REPLACE(sf.code,'$','s') IN ('150sa','150su')
            AND sf.value ILIKE %s
        ) AS ok
        """,
        (ds, entity_id, f"%{token}%"),
    ).fetchone()["ok"]
    assert ok

    query = f"""{PREFIXES}
SELECT DISTINCT ?w WHERE {{
  VALUES (?w) {{ (<{iri}>) }}
  ?w a vendclass:Work .
  ?w vend:hasField ?f .
  ?f vend:fieldCode "150" .
  ?f vend:hasSubfield ?sf .
  ?sf vend:subfieldCode ?code .
  ?sf vend:subfieldValue ?val .
  FILTER (?code IN ("150sa","150su"))
  FILTER regex(?val, "{token_re}", "i")
}}
"""
    _, rows = _run_select(endpoint, inject(query, ds), timeout_s=90)
    got = {r[0] for r in rows if r and r[0]}
    assert got == {iri}


def test_title_rewrite_manifestation_245a(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    sample = pg_conn.execute(
        """
        SELECT el.entity_id, sf.value AS title
        FROM entity_label el
        JOIN v_field f ON (f.dataset_id=el.dataset_id AND f.entity_id=el.entity_id)
        JOIN v_subfield sf ON (sf.dataset_id=el.dataset_id AND sf.entity_id=el.entity_id AND sf.field_idx=f.field_idx)
        WHERE el.dataset_id=%s
          AND el.type_norm='manifestation'
          AND f.tag='245'
          AND sf.code='245$a'
          AND sf.value <> ''
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    assert sample
    token = re.sub(r"\\s+", " ", str(sample["title"]).strip())
    token = token[:12].strip() or token
    token_re = _sparql_regex_escape(token)
    entity_id = sample["entity_id"]
    iri = _entity_iri(ds, entity_id)

    ok = pg_conn.execute(
        """
        SELECT EXISTS(
          SELECT 1
          FROM v_field f
          JOIN v_subfield sf ON (sf.dataset_id=f.dataset_id AND sf.entity_id=f.entity_id AND sf.field_idx=f.field_idx)
          WHERE f.dataset_id=%s
            AND f.entity_id=%s
            AND f.tag='245'
            AND REPLACE(sf.code,'$','s') IN ('245sa','245se','245sf')
            AND sf.value ILIKE %s
        ) AS ok
        """,
        (ds, entity_id, f"%{token}%"),
    ).fetchone()["ok"]
    assert ok

    query = f"""{PREFIXES}
SELECT DISTINCT ?m WHERE {{
  VALUES (?m) {{ (<{iri}>) }}
  ?m a vendclass:Manifestation .
  ?m vend:hasField ?f .
  ?f vend:fieldCode "245" .
  ?f vend:hasSubfield ?sf .
  ?sf vend:subfieldCode ?code .
  ?sf vend:subfieldValue ?val .
  FILTER (?code IN ("245sa","245se","245sf"))
  FILTER regex(?val, "{token_re}", "i")
}}
"""
    _, rows = _run_select(endpoint, inject(query, ds), timeout_s=90)
    got = {r[0] for r in rows if r and r[0]}
    assert got == {iri}


def test_traversal_manifestation_expression_work(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    sample = pg_conn.execute(
        """
        SELECT DISTINCT w.entity_id AS work_id, COALESCE(w.ark,'') AS work_ark
        FROM rel_edge rm
        JOIN entity eexp ON (eexp.dataset_id=rm.dataset_id AND eexp.ark=rm.tgt_ark)
        JOIN rel_edge re ON (re.dataset_id=rm.dataset_id AND re.src_entity_id=eexp.entity_id)
        JOIN entity w ON (w.dataset_id=re.dataset_id AND w.ark=re.tgt_ark)
        JOIN entity_label wl ON (wl.dataset_id=w.dataset_id AND wl.entity_id=w.entity_id AND wl.type_norm='oeuvre')
        WHERE rm.dataset_id=%s
          AND rm.predicate_iri='https://vendange.bnf.fr/relation/740s3'
          AND re.predicate_iri='https://vendange.bnf.fr/relation/750s3'
          AND COALESCE(w.ark,'') <> ''
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    assert sample
    work_ark = sample["work_ark"]

    expected_manifestations = {
        _entity_iri(ds, row["m_id"])
        for row in pg_conn.execute(
            """
            SELECT DISTINCT rm.src_entity_id AS m_id
            FROM rel_edge rm
            JOIN entity eexp ON (eexp.dataset_id=rm.dataset_id AND eexp.ark=rm.tgt_ark)
            JOIN rel_edge re ON (re.dataset_id=rm.dataset_id AND re.src_entity_id=eexp.entity_id)
            WHERE rm.dataset_id=%s
              AND rm.predicate_iri='https://vendange.bnf.fr/relation/740s3'
              AND re.predicate_iri='https://vendange.bnf.fr/relation/750s3'
              AND re.tgt_ark=%s
            """,
            (ds, work_ark),
        ).fetchall()
    }

    query = f"""{PREFIXES}
SELECT DISTINCT ?m WHERE {{
  ?m a vendclass:Manifestation .
  ?m vendrel:740s3 ?e .
  ?e vendrel:750s3 ?w .
  ?w vendprop:ark "{work_ark}" .
}}
"""
    _, rows = _run_select(endpoint, inject(query, ds), timeout_s=60)
    got = {r[0] for r in rows if r and r[0]}
    assert got == expected_manifestations


def test_inverse_property_paths_work_to_manifestations(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    sample = pg_conn.execute(
        """
        SELECT DISTINCT w.entity_id AS work_id
        FROM rel_edge rm
        JOIN entity eexp ON (eexp.dataset_id=rm.dataset_id AND eexp.ark=rm.tgt_ark)
        JOIN rel_edge re ON (re.dataset_id=rm.dataset_id AND re.src_entity_id=eexp.entity_id)
        JOIN entity w ON (w.dataset_id=re.dataset_id AND w.ark=re.tgt_ark)
        JOIN entity_label wl ON (wl.dataset_id=w.dataset_id AND wl.entity_id=w.entity_id AND wl.type_norm='oeuvre')
        WHERE rm.dataset_id=%s
          AND rm.predicate_iri='https://vendange.bnf.fr/relation/740s3'
          AND re.predicate_iri='https://vendange.bnf.fr/relation/750s3'
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    assert sample
    work_iri = _entity_iri(ds, sample["work_id"])

    expected_manifestations = {
        _entity_iri(ds, row["m_id"])
        for row in pg_conn.execute(
            """
            SELECT DISTINCT rm.src_entity_id AS m_id
            FROM rel_edge rm
            JOIN entity eexp ON (eexp.dataset_id=rm.dataset_id AND eexp.ark=rm.tgt_ark)
            JOIN rel_edge re ON (re.dataset_id=rm.dataset_id AND re.src_entity_id=eexp.entity_id)
            WHERE rm.dataset_id=%s
              AND rm.predicate_iri='https://vendange.bnf.fr/relation/740s3'
              AND re.predicate_iri='https://vendange.bnf.fr/relation/750s3'
              AND re.tgt_ark=(SELECT ark FROM entity WHERE dataset_id=%s AND entity_id=%s)
            """,
            (ds, ds, sample["work_id"]),
        ).fetchall()
    }

    query = f"""{PREFIXES}
SELECT DISTINCT ?m WHERE {{
  VALUES (?w) {{ (<{work_iri}>) }}
  ?w ^vendrel:750s3/^vendrel:740s3 ?m .
}}
"""
    _, rows = _run_select(endpoint, inject(query, ds), timeout_s=60)
    got = {r[0] for r in rows if r and r[0]}
    assert got == expected_manifestations


def test_alternative_path_work_to_person(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    sample = pg_conn.execute(
        """
        SELECT DISTINCT a.entity_id AS agent_id, COALESCE(a.ark,'') AS agent_ark
        FROM rel_edge r
        JOIN entity a ON (a.dataset_id=r.dataset_id AND a.ark=r.tgt_ark)
        JOIN entity_label al ON (al.dataset_id=a.dataset_id AND al.entity_id=a.entity_id AND al.type_norm='identite publique de personne')
        WHERE r.dataset_id=%s
          AND r.predicate_iri IN (
            'https://vendange.bnf.fr/relation/700s3',
            'https://vendange.bnf.fr/relation/701s3',
            'https://vendange.bnf.fr/relation/702s3'
          )
          AND COALESCE(a.ark,'') <> ''
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    assert sample
    agent_ark = sample["agent_ark"]

    expected_works = {
        _entity_iri(ds, row["work_id"])
        for row in pg_conn.execute(
            """
            SELECT DISTINCT r.src_entity_id AS work_id
            FROM rel_edge r
            JOIN entity_label wl ON (wl.dataset_id=r.dataset_id AND wl.entity_id=r.src_entity_id AND wl.type_norm='oeuvre')
            WHERE r.dataset_id=%s
              AND r.tgt_ark=%s
              AND r.predicate_iri IN (
                'https://vendange.bnf.fr/relation/700s3',
                'https://vendange.bnf.fr/relation/701s3',
                'https://vendange.bnf.fr/relation/702s3'
              )
            """,
            (ds, agent_ark),
        ).fetchall()
    }

    query = f"""{PREFIXES}
SELECT DISTINCT ?w WHERE {{
  ?w a vendclass:Work .
  ?w (vendrel:700s3|vendrel:701s3|vendrel:702s3) ?p .
  ?p vendprop:ark "{agent_ark}" .
}}
"""
    _, rows = _run_select(endpoint, inject(query, ds), timeout_s=60)
    got = {r[0] for r in rows if r and r[0]}
    assert got == expected_works


def test_full_traversal_manifestations_for_agent(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    sample = pg_conn.execute(
        """
        SELECT DISTINCT a.ark AS agent_ark
        FROM rel_edge rw
        JOIN entity a ON (a.dataset_id=rw.dataset_id AND a.ark=rw.tgt_ark)
        JOIN entity_label al ON (al.dataset_id=a.dataset_id AND al.entity_id=a.entity_id AND al.type_norm='identite publique de personne')
        JOIN entity w ON (w.dataset_id=rw.dataset_id AND w.entity_id=rw.src_entity_id)
        JOIN rel_edge re ON (re.dataset_id=rw.dataset_id AND re.tgt_ark=w.ark AND re.predicate_iri='https://vendange.bnf.fr/relation/750s3')
        JOIN entity exp ON (exp.dataset_id=re.dataset_id AND exp.entity_id=re.src_entity_id)
        JOIN rel_edge rm ON (rm.dataset_id=rw.dataset_id AND rm.tgt_ark=exp.ark AND rm.predicate_iri='https://vendange.bnf.fr/relation/740s3')
        WHERE rw.dataset_id=%s
          AND rw.predicate_iri IN (
            'https://vendange.bnf.fr/relation/700s3',
            'https://vendange.bnf.fr/relation/701s3',
            'https://vendange.bnf.fr/relation/702s3'
          )
          AND a.ark <> ''
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    assert sample
    agent_ark = sample["agent_ark"]

    expected_manifestations = {
        _entity_iri(ds, row["m_id"])
        for row in pg_conn.execute(
            """
            SELECT DISTINCT rm.src_entity_id AS m_id
            FROM rel_edge rw
            JOIN entity w ON (w.dataset_id=rw.dataset_id AND w.entity_id=rw.src_entity_id)
            JOIN rel_edge re ON (re.dataset_id=rw.dataset_id AND re.tgt_ark=w.ark AND re.predicate_iri='https://vendange.bnf.fr/relation/750s3')
            JOIN entity exp ON (exp.dataset_id=re.dataset_id AND exp.entity_id=re.src_entity_id)
            JOIN rel_edge rm ON (rm.dataset_id=rw.dataset_id AND rm.tgt_ark=exp.ark AND rm.predicate_iri='https://vendange.bnf.fr/relation/740s3')
            WHERE rw.dataset_id=%s
              AND rw.tgt_ark=%s
              AND rw.predicate_iri IN (
                'https://vendange.bnf.fr/relation/700s3',
                'https://vendange.bnf.fr/relation/701s3',
                'https://vendange.bnf.fr/relation/702s3'
              )
            """,
            (ds, agent_ark),
        ).fetchall()
    }

    query = f"""{PREFIXES}
SELECT DISTINCT ?m WHERE {{
  ?agent vendprop:ark "{agent_ark}" .
  ?agent ^(vendrel:700s3|vendrel:701s3|vendrel:702s3) ?w .
  ?w ^vendrel:750s3 ?e .
  ?e ^vendrel:740s3 ?m .
}}
"""
    _, rows = _run_select(endpoint, inject(query, ds), timeout_s=90)
    got = {r[0] for r in rows if r and r[0]}
    assert got == expected_manifestations


def test_subfield_code_normalization_keeps_case(ontop_endpoint, ontop_dataset_id, pg_conn, inject):
    ds = ontop_dataset_id
    endpoint = ontop_endpoint.sparql_url

    sample = pg_conn.execute(
        """
        SELECT DISTINCT sf.entity_id, f.tag, sf.code
        FROM v_field f
        JOIN v_subfield sf ON (sf.dataset_id=f.dataset_id AND sf.entity_id=f.entity_id AND sf.field_idx=f.field_idx)
        WHERE f.dataset_id=%s
          AND sf.code LIKE '%%$%%'
          AND sf.code ~ '[A-Z]'
        LIMIT 1
        """,
        (ds,),
    ).fetchone()
    assert sample
    e_iri = _entity_iri(ds, sample["entity_id"])
    tag = sample["tag"]

    expected_codes = {
        row["code_norm"]
        for row in pg_conn.execute(
            """
            SELECT DISTINCT REPLACE(sf.code,'$','s') AS code_norm
            FROM v_field f
            JOIN v_subfield sf ON (sf.dataset_id=f.dataset_id AND sf.entity_id=f.entity_id AND sf.field_idx=f.field_idx)
            WHERE f.dataset_id=%s AND f.entity_id=%s AND f.tag=%s
            """,
            (ds, sample["entity_id"], tag),
        ).fetchall()
    }

    query = f"""{PREFIXES}
SELECT DISTINCT ?code WHERE {{
  VALUES (?e) {{ (<{e_iri}>) }}
  ?e vend:hasField ?f .
  ?f vend:fieldCode "{tag}" .
  ?f vend:hasSubfield ?sf .
  ?sf vend:subfieldCode ?code .
}}
"""
    _, rows = _run_select(endpoint, inject(query, ds), timeout_s=60)
    got = {r[0] for r in rows if r and r[0]}
    assert got == expected_codes
