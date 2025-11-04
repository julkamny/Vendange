import sys

from pyoxigraph import Store, NamedNode, BlankNode, Literal

DATASET = "data_curation/api/datasets/current-exportcsv"

QUERY = """
PREFIX vf: <https://vendange.bnf.fr/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX vfcls: <https://vendange.bnf.fr/class/>

SELECT ?entity ?field ?fieldCode ?graph
WHERE {
  VALUES (?requiredCode ?requiredType) {
    ("150" vfcls:Work)
    ("245" vfcls:Manifestation)
  }
  GRAPH ?graph {
    ?entity a ?requiredType ;
            vf:hasField ?field .
    ?field  vf:fieldCode ?fieldCode ;
            vf:hasSubfield ?trigger .
    ?trigger vf:subfieldValue ?triggerValue .
  }
}
LIMIT 100000
"""

HAS_SUBFIELD = NamedNode("https://vendange.bnf.fr/hasSubfield")
SUBFIELD_CODE = NamedNode("https://vendange.bnf.fr/subfieldCode")
SUBFIELD_VALUE = NamedNode("https://vendange.bnf.fr/subfieldValue")


def subfield_order(node: BlankNode) -> int:
    try:
        return int(str(node.value).rsplit("-s-", 1)[1].split("-", 1)[0])
    except Exception:
        return sys.maxsize


def fetch_subfields(store: Store, field, graph) -> str:
    codes = {}
    values = {}
    for quad in store.quads_for_pattern(field, HAS_SUBFIELD, None, graph):
        sub_node = quad.object
        for code_quad in store.quads_for_pattern(sub_node, SUBFIELD_CODE, None, graph):
            if isinstance(code_quad.object, Literal):
                codes[sub_node] = code_quad.object.value
        for val_quad in store.quads_for_pattern(sub_node, SUBFIELD_VALUE, None, graph):
            if isinstance(val_quad.object, Literal):
                values[sub_node] = val_quad.object.value
    ordered = sorted(codes.keys(), key=subfield_order)
    segments: list[str] = []
    for node in ordered:
        code = codes.get(node, "")
        value = values.get(node, "")
        if code and value:
            suffix = code.split("$", 1)[1] if "$" in code else code
            segments.append(f"${suffix} {value}")
    return " ".join(segments)


def main() -> None:
    try:
        store = Store.read_only(DATASET)
    except OSError as exc:
        print(f"Failed to open store: {exc}", file=sys.stderr)
        return

    try:
        results = list(store.query(QUERY))
    except Exception as exc:  # pragma: no cover
        print(f"Query failed: {exc}", file=sys.stderr)
        return

    for solution in results:
      if solution["fieldCode"].value in ["150","245"]:
        entity = solution["entity"].value
        field = solution["field"]
        graph = solution["graph"]
        field_code = solution["fieldCode"].value
        field_line = fetch_subfields(store, field, graph)
        if all(c in field_line for c in [r"[","]"]):
          print(f"{entity} {field_code} {field_line}")


if __name__ == "__main__":
    main()
