# scripts/authority/sru_client.py
from __future__ import annotations
import xml.etree.ElementTree as ET
from typing import List, Tuple
import urllib.parse
import urllib.request

SRU_BASE = "https://catalogue.bnf.fr/api/SRU"

NS = {
    "srw": "http://www.loc.gov/zing/srw/",
    "mxc": "info:lc/xmlns/marcxchange-v2",
}

def _sru_url_for_ark(ark: str) -> str:
    q = f'aut.persistentid any "{ark}"'
    params = {
        "version": "1.2",
        "operation": "searchRetrieve",
        "query": q
    }
    return f"{SRU_BASE}?{urllib.parse.urlencode(params)}"

def fetch_marcxchange_xml(ark: str) -> str:
    url = _sru_url_for_ark(ark)
    with urllib.request.urlopen(url) as resp:
        return resp.read().decode("utf-8")

def _join_name(df: ET.Element) -> str:
    """UNIMARC Autorité Personne: 200/400 - combine $a (élément d'entrée), $b (reste du nom), $c (qualificatifs éventuels)."""
    parts: List[str] = []
    for code in ("a", "b", "c"):
        for sf in df.findall(f'./mxc:subfield[@code="{code}"]', NS):
            val = (sf.text or "").strip()
            if val:
                parts.append(val)
    return " ".join(parts)

def parse_variants_from_sru(xml_text: str) -> Tuple[List[str], List[str]]:
    """
    Retourne (accepted_forms, rejected_forms) à partir des tags 200 (forme admise) et 400 (formes rejetées).
    """
    root = ET.fromstring(xml_text)
    rec = root.find(".//mxc:record", NS)
    if rec is None:
        return [], []
    accepted: List[str] = []
    rejected: List[str] = []

    for df in rec.findall('./mxc:datafield[@tag="200"]', NS):
        name = _join_name(df)
        if name:
            accepted.append(name)

    for df in rec.findall('./mxc:datafield[@tag="400"]', NS):
        name = _join_name(df)
        if name:
            rejected.append(name)

    # déduplication en gardant l'ordre
    def dedup(seq: List[str]) -> List[str]:
        seen = set(); out=[]
        for x in seq:
            if x not in seen:
                seen.add(x); out.append(x)
        return out

    return dedup(accepted), dedup(rejected)

def get_person_variants(ark: str) -> List[str]:
    """
    Enchaîne fetch + parse. Renvoie toutes les variantes utiles (200 + 400).
    """
    xml_text = fetch_marcxchange_xml(ark)
    acc, rej = parse_variants_from_sru(xml_text)
    variants = acc + rej
    payload = list(dict.fromkeys(variants))
    # print(payload)
    return payload  # dédupli ordonné