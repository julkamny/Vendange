## Tips & instructions

- When deriving the internal identifier from an ark, we need to remove the prefix up to `cb` and drop the final control character, e.g. `ark:/12148/cb359748158 -> 35974815`.
- Note down (Agents.md, ## Incremental agent knowledge) the useful information you've retrieved along the way during your work, to help future agents get down to work more quickly and reach a correct, accurate grasp of the data structure, the project's implicit architecture, etc. In brief, write down what you wish you had known when you started working on this mission.

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

## Incremental agent knowledge
- Unclustered work navigation: `openUnclusteredWorkExpressions` sets `listScope` to `inventory` and `viewMode` to `expressions`; going back to works must switch `listScope` to `clusters`, `viewMode` to `works`, and update `highlightedWorkArk` so the unified work list reopens with the originating work highlighted.
- Keyboard “go to parent” uses `focusInventoryTreeUp`; ensure the expression branch mirrors the breadcrumb behavior by calling `showRecordDetails` for the parent work after flipping back to the cluster scope.
- Intermarc rendering now exposes resolved ARK labels via `prettyPrintIntermarc`, which returns `{ text, tokens }` with token markers (`ARK_TOKEN_START/END`); UI code must decode these markers into tooltip spans instead of treating the text as plain strings.
