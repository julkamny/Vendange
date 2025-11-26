# Adaptation heuristics

Work A has 1 agent with relator code « Auteur du texte / Autrice du texte » and neither its title nor the title of its manifestations suggest it’s an adaptation:
+ It can be **clustered** with works with the same title (after cleaning) and the same agent with relator code « Auteur du texte / Autrice du texte » + any number of other agents (0 or more), as long as none of these agents has as relator code « Responsable de l'adaptation » and neither the title of the work nor the title of its manifestations suggest it’s an adaptation.
+ An adaptation link can be created between work A and a work analyzed as an adaptation (see below).

Work B has been analyzed as an adaptation, either because of the relator code of one of its agents, or because of its title, or because of the title of its manifestations:
+ An adaptation link can be created to work A if work A is not an adaptation and ALL the agents of work A are found in work B (although in work B their relator code might be different). Work A gets `552$q` "A pour adaptation", work B `552$q` "Est une adaptation de".
+ Work B can be clustered with works with the same title and the same agents that are also considered as adaptations of the same original work. In this case, different relator codes should not block clustering, as long as we know both works are adaptations.
