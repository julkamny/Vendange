## Codebase hygiene & design

- We're not in production yet, we haven't deployed to users, so no need to handle legacy patterns, datasets and the like, just remove all dead code and abandoned implementations cautiously.
- Update the README once you're done working to make sure it reflects the current state of the app.
- Strive to avoid introducing repetition in the codebase, reuse as much code as possible to implement what you've been asked.
- When a file gets too long (more than 500 LOC), break it down into smaller files. Don't allow a file to grow out of hand.
- Once you're done working, if you've touched files in the React app living in data_inspection, you need to execute `npm run lint`.
- If you've touched files in the FastAPI Python back-end, use `uv run ruff check` and pytest.

## Tips

- If you need to run Python, know that the .venv at the root of the repo (where you've been summoned) is managed by uv.
- Do `uv run` when running a command.

## Databases

- The searchable datasets uploaded by users are Oxigraph stores under `data_curation/api/datasets/`, created from user-provided CSVs of Intermarc records. A development sample lives in `sample_data/current_export.csv`.
- The DB can be inspected with the Oxigraph CLI or `uv run pyoxigraph`, see [sparql_store.md](documentation/sparql_store.md)

## Intermarc

- In the brand of Intermarc we're dealing with, $a IS COMPLETELY DIFFERENT from $A, $b from $B, etc. Capital letter and lower-case should never be conflated in FIELD CODE or SUBFIELD CODE. Make sure this logic is honored whenever you have to touch files related to Intermarc.
- In our SPARQL databases, the `$` between the field and the subfield has been replaced with `s`. So `90F$q` becomes `90Fsq`.

## Linked entity ontology

- Links between WEM entities:
	- Parent to children:
		- A manifestation points in its `740$3` subfield to one or more expressions, each expression points in its `750$3` subfield to one single work. A work can have multiple expressions, an expression can have multiple manifestations.
		- A manifestation with ancestor Work A originally, upon cleaning, might end up having as ancestor Work B instead.
	- Clustering: 
		- Entity has a `90F` field in the 'intermarc as json' with a subfield `90F$a` that contains the ark of the clustered entity. Entities can only be clustered with entities of the same nature (œuvre → œuvre, expression → expression, manifestation → manifestation).
- General relationship: 
		- Fields 500, 501, 506, 509, 50N, 54T, 550, 551, 552, 553, 554, 555, 556, 557, 557, 559, 55A, 55B, 55C, 55E, 55F, 55M, 55P, 55R, 55S, 55Z in a work entity (fr. œuvre), pointing in subfield `$3` to the ark of another entity (any of work, expression, manifestation).
		- Fields 501, 506, 509, 50N, 540, 541, 542, 543, 544, 547, 54C, 54P, 54T in an expression entity, pointing in subfield `$3` to the ark of another entity (any of work, expression, manifestation).
		- Fields 501, 506, 509, 50N, 530, 531, 532, 533, 534, 535, 536, 537, 538, 53M in a manistation entity, pointing in subfield `$3` to the ark of another entity (any of work, expression, manifestation).
- Agent to WEM :
	- `$3` subfield in fields 700, 701, 702, as well as 710, 711, 712.

## Adaptation heuristics

Work A has 1 agent with relator code « Auteur du texte / Autrice du texte » and neither its title nor the title of its manifestations suggest it’s an adaptation:
+ It can be **clustered** with works with the same title (after cleaning) and the same agent with relator code « Auteur du texte / Autrice du texte » + any number of other agents (0 or more), as long as none of these agents has as relator code « Responsable de l'adaptation » and neither the title of the work nor the title of its manifestations suggest it’s an adaptation.
+ An adaptation link can be created between work A and a work analyzed as an adaptation (see below).

Work B has been analyzed as an adaptation, either because of the relator code of one of its agents, or because of its title, or because of the title of its manifestations:
+ An adaptation link can be created to work A if work A is not an adaptation and ALL the agents of work A are found in work B (although in work B their relator code might be different). Work A gets `552$q` "A pour adaptation", work B `552$q` "Est une adaptation de".
+ Work B can be clustered with works with the same title and the same agents that are also considered as adaptations of the same original work. In this case, different relator codes should not block clustering, as long as we know both works are adaptations.
