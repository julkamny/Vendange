# retrospective_cataloguing_prompt

- Examine les informations suivantes relatives à des livres, issues de leurs notices Intermarc. 
- Segmente leurs titres si nécessaire, contenus en zone 245, zone réservée au(x) titre(s) et mention(s) de responsabilité. Segmenter signifie placer des \$ (même symbole que pour la monnaie) suivis d'une lettre au bon endroit de la chaîne de caractères composant le titre pour le délimiter en sous-zones. Par exemple `$a` et `$b` sont des sous-zones. Utilise un dictionnaire comme `{""code"": ""245"", ""sousZones"": [{""code"": ""245$a"", ""valeur"": ""foo""}, {""code"": ""245$f"", ""valeur"": ""bar""},]},`
- Les mentions d'édition comme "nouvelle édition", "6e édition", etc doivent être enregistrées en zone 250 :

```csv
250$a,Mention d'édition
250$H,Numéro d'édition
```

- La signification des sous-zones de la zone 245 est la suivante :

```csv
245$a,Titre
245$b,Autre titre du même auteur
245$c,Autre titre d'un auteur différent
245$e,Complément du titre
245$f,Première mention de responsabilité
245$g,Mention de responsabilité suivante
245$h,Numéro de partie : sous-zone de transcription
245$i,Titre dépendant
245$j,Mention de responsabilité interprète
245$r,Reste de la zone
245$v,Numéro
245$w,Commentaires sur le titre ou la mention de responsabilité
245$z,Précisions
```

- Quand un livre contient plusieurs zones 245 (résultat d'une erreur humaine), gardes-en une, et distribue l'information contenue par les autres dans des sous-zones de l'unique zone 245.
- Extrais du titre les agents impliqués dans l'œuvre et indique les codes fonctions (chaque agent peut en avoir un ou plusieurs) qui caractérisent le mieux la nature de leur contribution. Les codes-fonctions autorisés sont donnés ci-dessous.
- Un même agent peut avoir plusieurs codes-fonctions, s'il est responsable et de l'illustration ET de l'adaptation par exemple.
- Après avoir segmenté le titre et indiqué les agents avec leurs codes-fonctions respectifs, donne ta réponse aux questions suivantes dans le format JSON prescrit :
  1. S'agit-il de l'adaptation d'une autre œuvre ? Les indices d'adaptation sont notamment les expressions suivantes (liste non limitative) : "tiré de", "adapté de", "d'après" (e. g. les œuvres de tel auteur), etc.
  2. S'agit-il de l'édition abrégée d'une œuvre ? Les indices d'abréviation sont notamment (liste non limitative) : "texte abrégé", "édition abrégée", "extraits", etc.
  3. S'agit-il d'un agrégat ? Un agrégat est une œuvre comprenant plusieurs œuvres individuelles regroupées en un ou plusieurs volumes. La présence de zones de dépouillement est un indice fort. Il arrive toutefois qu'une œuvre soit un agrégat malgré l'absence de ces zones. Son seul titre suffit souvent à statuer, par exemple *Œuvres choisies de Victor Hugo*.

## Format de sortie attendu

```json
[
  {
    "manifestation_identifiant": str,
    "champs": 
    [
      {"code":str,"sousZones":[{"code":str, "valeur":str},]},
      {"code":str,"sousZones":[{"code":str, "valeur":str},]},
    ],
    "agents":
    [
      {zone:int,"nom": str,"codes_fonctions": [str,]}, 
      {zone:int,"nom": str,"codes_fonctions": [str,]}, 
    ],
    "est_adaptation": bool,
    "est_abréviation":bool,
    "est_extrait": bool,
    "est_agrégat": bool,
  },
]
```

## Codes-fonctions

\[
"Responsable de l'adaptation",
"Abréviateur / Abréviatrice",
"Auteur des notes éditoriales / Autrice des notes éditoriales",
"Rédacteur d'une notice descriptive / Rédactrice d'une notice descriptive",
"Auteur du texte / Autrice du texte",
"Créateur de l'œuvre source (Auteur du texte) / Créatrice de l'œuvre source (Autrice du texte)",
"Auteur de la transcription / Autrice de la transcription",
"Créateur de l'animation / Créatrice de l'animation",
"Auteur de lettres / Autrice de lettres",
"Auteur de l'idée originale / Autrice de l'idée originale",
"Auteur du matériel d'accompagnement / Autrice du matériel d'accompagnement",
"Collaborateur / Collaboratrice",
"Concepteur / Conceptrice",
"Dessinateur / Dessinatrice",
"Éditeur intellectuel / Éditrice intellectuelle",
"Illustrateur / Illustratrice",
"Postfacier / Postfacière",
"Préfacier / Préfacière",
"Producteur / Productrice [films, émissions…]",
"Société de production",
"Réalisateur / Réalisatrice",
"Scénariste",
"Traducteur / Traductrice",
"Créateur de l'œuvre agrégative / Créatrice de l'œuvre agrégative",
"Acteur / Actrice",
"Voix parlée",
\]

## Livres à traiter