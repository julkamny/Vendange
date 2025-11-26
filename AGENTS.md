## Codebase hygiene & design

- Strive to avoid introducing repetition in the codebase, reuse as much code as possible to implement what you've been asked.
- We're not in production yet, we haven't deployed to users, so no need to handle legacy patterns, datasets and the like, just remove all dead code and abandoned implementations cautiously.
- Update the README once you're done working to make sure it reflects the current state of the app.
- Strive not to add more LOC to a file if it's above the 500 ~ 600 limit, and whenever you have the occasion to extract from a large file (600 < LOC) pieces, chunks, functions, seize the opportunity to refactor.
- Strive for DRY : don't repeat it yourself, better to import / refactor code to make it more general than to rewrite something that already exists.
- Once you're done working, if you've touched files in the React app living in data_inspection, you need to execute `npm run lint`.
- If you've touched files in the FastAPI Python backend, use `uv run ruff check` and pytest tests/backend.

## Tests

- Built with Playwright Pytest, located in /tests, run them once you've finished working.
- The FastAPI backend is running at `http://127.0.0.1:8000`, the frontend is available at `http://localhost:5173/`.

## Tips

- If you need to use Python, do `uv run` when running a command.

## Databases

- The searchable datasets uploaded by users are Oxigraph stores under `data_curation/api/datasets/`, created from user-provided CSVs of Intermarc records.
- Databases can be inspected with the Oxigraph CLI or `uv run pyoxigraph`, see [sparql_store.md](documentation/sparql_store.md)

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