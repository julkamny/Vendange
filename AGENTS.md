## Tips & instructions

- When deriving the internal identifier from an ark, we need to remove the prefix up to `cb` and drop the final control character, e.g. `ark:/12148/cb359748158 -> 35974815`.
- If you need to run Python, know that the .venv at the root of the repo (where you've been summoned) is managed by uv.
- The searchable datasets uploaded by users are now Oxigraph stores under `data_curation/api/datasets/`. They are generated from CSV holding intermarc records of LRM entities (e.g. `current_export.csv`) whenever the user uploads a  file in the React app.
- The DB can be inspected with the Oxigraph CLI, see [sparql_store.md](documentation/sparql_store.md)

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

## Design and coding philosophy

- When a file gets too long (more than 500 LOC), break it down into smaller files. Don't allow a file to grow out of hand.