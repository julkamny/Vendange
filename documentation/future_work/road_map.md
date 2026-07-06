============================
🧐 Data curation

============================

    Finish building the NLP pipeline and ensure the results are accurate in the Comtesse de Ségur dataset:

    Handle 150$u properly, to abort clustering or proceed with it depending on the information contained in this subtitle.
    Handle 150$h and 150$i subfields, which contain information about volume segmentation and volume title, to avoid clustering two parts of the same work (see RDA-FR).
    Untangle clusters created during the first clustering operations, after the initial migration of the catalog to the Intermarc-NG format / RDA-FR cataloging code. See examples in the relevant issue.
    Clustering aggregative works (fr. œuvre agrégative) with individual works (fr. œuvre simple), when appropriate.
    Clustering combined works (fr. œuvre mixte) with purely textual works (fr. œuvre textuelle), when appropriate.
    Handle cases where works share the same title and at least one creator, but one has more creators than the other.
    Handle adaptations correctly.
        Currently, judging by the outcome and by the logs of a clustering w/ adaptation-linking run, it looks like adaptation matching doesn't start from the form of the title after cleansing. E.g. 150 $3 Argeliès Micheline $a Les |Malheurs de Sophie. Adapté par Micheline Argeliès. Images de François Batet $9 B245 and 150 $3 Pitray Paul de $3 Ségur Sophie de $3 Fabrice Delphi $a Paul de Pitray et Delphi Fabrice. Un |bon petit diable $9 B245. Should be easy to fix.
    Handle abbreviated editions correctly.
    Look for manifestations that should belong to another work, e.g. 245$g mentions adaptation, while neither the sibling manifestations nor the ancestor work do.
    Cluster expressions of a given work when required, e.g. if publishing indications in subfield 014$s are not relevant, which can only be established upon examining its manifestations.
    Among manifestations of a given expression, check if number of pages varies widely to detect potential adaptations or abridged versions of the text, what would need to be linked to a different expression and/or work.

    Move on to other samples of the National Library catalog and tackle other challenges:

    Anonymous works.
    Cases where the translator is not mentioned, e.g. old translations of the Grimms' tales.
    Frequently republished comics properly (e.g. Gosciny & Uderzo, Franquin).
    Book series in which the publisher of the translation divides the original volumes differently, e.g. Le Trône de fer, L'Assassin royal.
    School textbooks.