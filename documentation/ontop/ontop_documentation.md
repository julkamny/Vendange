This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: **/*.csv, *.csv, agent_interactions/, **/datasets/, **/controlledListsData.ts, **/*.css, **/controlled_lists.json
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
Basic Lens _ Ontop.html
Command Line Interface _ Ontop.html
Configuration keys _ Ontop.html
Flatten Lens _ Ontop.html
Getting started _ Ontop.html
Interact with an Ontop SPARQL Endpoint _ Ontop.html
Introduction _ Ontop.html
Join Lens _ Ontop.html
Key concepts _ Ontop.html
Lenses _ Ontop.html
Ontop Mapping Language _ Ontop.html
Presentation _ Ontop.html
Role of foreign keys _ Ontop.html
Role of primary keys (unique constraints) _ Ontop.html
Setting up an Ontop SPARQL endpoint with Ontop CLI _ Ontop.html
SQL Lens _ Ontop.html
Union Lens _ Ontop.html
```

# Files

## File: Basic Lens _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
          + Projection <https://ontop-vkg.org/tutorial/lenses/basic-
            lens.html#projection>
          + Filter <https://ontop-vkg.org/tutorial/lenses/basic-
            lens.html#filter>
          + Adding Constraints <https://ontop-vkg.org/tutorial/lenses/
            basic-lens.html#adding-constraints>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#basic-lens> Basic Lens

Basic lenses can be used on one base relation, over which we can apply a
filter, an extended projection, and additional constraints.


    # <#projection> Projection

For this section, we first look at the table |museums| from the DuckDB
database. This table has the following schema:

column 	type
museum_id 	integer
name 	string
address 	string
yearly_income 	integer
yearly_spendings 	integer
ratings 	array of floats

The column |museum_id| is a primary key.

Now, we make two decisions:

 1. The |ratings| column is not important to us, so we want to remove it.
 2. The columns |yearly_income| and |yearly_spendings| are not
    interesting, but we would like to know the yearly profit (/income -
    spendings/)

Both of these goals can be achieved using a single basic lens. The basic
lens has the following structure:

|{
    "name": [String],
    "baseRelation": [String],
    "columns": {
        "added": [{
            "name": String,
            "expression": String
        }],
        "hidden": [String]
    },
    "filterExpression": String,
    "type": "BasicLens"
}
|

We can prepare our |lenses.json| file like this:

|{
    "relations": [
        {
            "name": ["lenses", "museum_projection"],
            "baseRelation": ["museums"],
            "columns": {
                "added": ..., 
                "hidden": ...
            },
            "type": "BasicLens"
        }
    ]
}
|

As we do not require a filter, we do not need the field |
filterExpression|. The field |columns| can be used to list existing
columns that should be removed and new columns that should be added.

Above, we decided that the fields |ratings|, |yearly_income| and |
yearly_spendings| are not interesting to us. We can easily hide them by
including their names in the |hidden| list.

To add a new |yearly_profit| field, we have to add one entry to the |
added| list, using |yearly profit| as its name, and using the expression
|yearly_income - yearly_spendings| in its |expression| field.

NOTE

Even though we have decided to hide the columns |yearly_income| and |
yearly_spendings|, we can still use them for expressions within the same
lens.

After making these changes, the full |lenses.json| file should look like
this:

|{
    "relations": [
        {
            "name": ["lenses", "museum_projection"],
            "baseRelation": ["museums"],
            "columns": {
                "added": [
                    {
                        "name": "yearly_profit",
                        "expression": "CAST(yearly_income - yearly_spendings as INTEGER)"
                    }
                ],
                "hidden": ["ratings", "yearly_income", "yearly_spendings"]
            },
            "type": "BasicLens"
        }
    ]
}
|

NOTE

In the expression for |yearly_profit|, we cast the result of the
subtraction to an |INTEGER|. This way, Ontop is guaranteed to know that
the column will be of type |INTEGER|.


      # <#mapping> Mapping

Now that we have created a basic lens to re-format the input table, we
can use the lens in a mapping. For this, we start with the mapping
template provided in the tutorial files. This template already contains
basic mappings that define individuals of the classes |:Museum| and
|:Worker|.

We now want to set the |:yearlyProfit| datatype property for all
museums. We can achieve that by adding the following mapping:

|mappingId	MAPID-museum-profit
target		data:museum/{museum_id} :yearlyProfit {yearly_profit} .
source		SELECT museum_id, yearly_profit FROM lenses.museum_projection;
|

After doing that, we can copy the |lenses.json| and |mapping.obda| files
into the Ontop endpoint |input| directory, as described in the setup
page <https://ontop-vkg.org/tutorial/lenses/setup.html> and start the
endpoint. Once the endpoint is started, we can open the SPARQL query
editor at http://localhost:8080(opens new window) <http://
localhost:8080/> and run the following query to test it:

|PREFIX : <http://example.org/museum_kg/>
SELECT ?name ?profit WHERE {
    ?museum a :Museum .
    ?museum :name ?name .
    ?museum :yearlyProfit ?profit .
}
|

If the lenses and mappings were constructed correctly, this query should
return a list of museum names, together with different values for their
yearly profit.

NOTE

Notice how by changing the source query by adding |ratings|, |
yearly_income|, or |yearly_spendings| to it, the execution of the
mapping fails, stating that the columns were not found. This is because
they were hidden by the lens.


    # <#filter> Filter

Another use case of basic lenses is to filter out some specific rows
from the input table. As an example, we will look at the table |
workers|. This table has the following schema:

column 	type
worker_id 	integer
full_name 	string
role 	string
museum_id 	integer
titles 	array of strings
access_level 	integer

The column |worker_id| is a primary key. The column |museum_id| is a
foreign key that references the table |museums|.

The column |role| is a string that indicates the name of the worker's
role. It can take the following three values: |"manager"|, |"guide"|,
and |"guard"|. For our VKG, we decide that we want to designate all
managers as individuals of the class |:Manager|. One way to achieve this
is to use the filter feature of basic lenses.

We can prepare our |lenses.json| file like this:

|{
    "relations": [
        {
            "name": ["lenses", "managers_filter"],
            "baseRelation": ["workers"],
            "filterExpression": ...,
            "type": "BasicLens"
        }
    ]
}
|

The |columns| field can be removed, as it is not required for this
example. Now, we just need to define a value for the field |
filterExpression| that ignores all rows for which the column |role| is
not equal to |"manager"|. The |filterExpression| is defined as a SQL
expression in the same style as SQL |WHERE| clauses.

After making this change, the full |lenses.json| file should look like this:

|{
    "relations": [
        {
            "name": ["lenses", "managers_filter"],
            "baseRelation": ["workers"],
            "filterExpression": "role = 'manager'",
            "type": "BasicLens"
        }
    ]
}
|


      # <#mapping-2> Mapping

We can once again use the generated lens in our mapping file. For this,
we will again extend the mapping template with one new mapping:

|mappingId	MAPID-worker-managers
target		data:worker/{worker_id} a :Manager .
source		SELECT worker_id FROM lenses.managers_filter;
|

Then, we start the Ontop endpoint and open the SPARQL editor to run the
following query:

|PREFIX : <http://example.org/museum_kg/>
SELECT ?name WHERE {
    ?worker a :Manager .
    ?worker :name ?name .
}
|

This should result in a list of /3/ manager names.

WARNING

All examples in the lens sections are compatible with each other.
However, all lenses referenced in the mapping file need to be included
in |lenses.json|. If you wish to continuously extend the mapping file
throughout the tutorial, you will also need to keep all previous lenses
in the |relations| list of the lenses file, otherwise, Ontop will throw
an error. Alternatively, you can always start each of the sections from
a new mapping template file. This way, only the lenses of the current
exercise have to be included.

As an extension to this exercise, you can now try to define similar
lenses and mappings for the |"guide"| and |"guard"| roles, assigning
them to the classes |:Guide| and |:Guard|, respectively.


    # <#adding-constraints> Adding Constraints

Another valuable feature of lenses is adding further constraints to
relations. This feature is supported for *all* types of lenses, but we
will cover it in this section only.

Generally, Ontop can infer many constraints from the base relation used
by a lens. For instance, the field |museum_id| in the table |museumS| is
a primary key, so it is /unique/ and /not null/. Our previously defined
lens will be able to infer that the output relation is still unique and
not null. On the other hand, for composite primary keys, if one part of
the composite key is hidden by a lens, then Ontop knows that the
remaining part is no longer guaranteed to be unique.

In many instances, however, expert knowledge can be used to define
further constraints for lenses. A full list of all supported constraints
and how they can be defined can be found in the documentation of lenses
<https://ontop-vkg.org/guide/advanced/lenses.html>.

For this section, we want to use our expert knowledge of the table |
workers| to provide the following constraints:

 1. The name of a worker is /unique/ and /not null/.
 2. The role of a worker is /not null/
 3. There is a functional dependency from /role/ to /access_level/.
 4. The column |museum_id| is a foreign key that references the table |
    museums| (DuckDB does not have a notion of foreign keys, so it is
    useful to add it explicitly).
 5. The |role| column is /IRI-safe/ (all possible values of the column
    can be safely included in an IRI without further encoding).

We can create a basic lens over the table |workers| to define these
constraints, following the guidelines from the documentation of lenses
<https://ontop-vkg.org/guide/advanced/lenses.html>. A possible solution
could look like this:

|{
    "relations": [
        {
            "name": ["lenses", "workers_constraints"],
            "baseRelation": ["workers"],
            "uniqueConstraints": {
                "added": [
                    {
                        "name": "uc",
                        "determinants": ["full_name"]
                    }
                ]
            },
            "nonNullConstraints": {
                "added": [
                    "full_name",
                    "role"
                ]
            },
            "otherFunctionalDependencies": {
                "added": [
                    {
                        "determinants": ["role"],
                        "dependents": ["access_level"]
                    }
                ]
            },
            "foreignKeys": {
                "added": [
                    {
                        "name": "fk",
                        "from": ["museum_id"],
                        "to": {
                            "relation": ["museumS"],
                            "columns": ["museum_id"]
                        }
                    }
                ]
            },
            "iriSafeConstraints": {
                "added": [
                    "role"
                ]
            },
            "type": "BasicLens"
        }
    ]
}
|

*Lenses can reference each other!* As a further exercise, you can try
using this newly created lens as the |baseRelation| of the managers
filter from before. Once that is done, you can query it again - the
results should be the same as before.

NOTE

We could also have added all of these constraints to the same |
managers_filter| lens from the previous section to achieve the same
results. This has the advantage of reducing the work required for the
lens setup and reducing the total number of relations accessible by
Ontop, but it is less flexible, as we would have to copy all the
constraints to the |guides_filter| and |guard_filter| lenses as well,
resulting in a lot of duplication.

Generally, the optimal solution depends on the specific scenario.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/lenses/basic-lens.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
setup.html> Join Lens <https://ontop-vkg.org/tutorial/lenses/join-
lens.html> →
```

## File: Command Line Interface _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Guide

      o Introduction <https://ontop-vkg.org/guide/>
      o Key concepts <https://ontop-vkg.org/guide/concepts.html>
      o Getting started <https://ontop-vkg.org/guide/getting-started.html>
      o Command Line Interface <https://ontop-vkg.org/guide/cli.html>
          + Setup Ontop CLI <https://ontop-vkg.org/guide/cli.html#setup-
            ontop-cli>
          + ontop endpoint <https://ontop-vkg.org/guide/cli.html#ontop-
            endpoint>
          + ontop materialize <https://ontop-vkg.org/guide/
            cli.html#ontop-materialize>
          + ontop mapping <https://ontop-vkg.org/guide/cli.html#ontop-
            mapping>
          + ontop bootstrap <https://ontop-vkg.org/guide/cli.html#ontop-
            bootstrap>
          + ontop query <https://ontop-vkg.org/guide/cli.html#ontop-query>
          + ontop extract-db-metadata <https://ontop-vkg.org/guide/
            cli.html#ontop-extract-db-metadata>
      o Standards compliance <https://ontop-vkg.org/guide/compliance.html>

  *

    Advanced

      o Ontop Mapping Language <https://ontop-vkg.org/guide/advanced/
        mapping-language.html>
      o Predefined query endpoint (beta) <https://ontop-vkg.org/guide/
        advanced/predefined.html>
      o Query logging <https://ontop-vkg.org/guide/advanced/logging.html>
      o HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
      o Configuration keys <https://ontop-vkg.org/guide/advanced/
        configuration.html>
      o Lenses <https://ontop-vkg.org/guide/advanced/lenses.html>

  *

    Data sources

  *

    Troubleshooting

      o FAQ <https://ontop-vkg.org/guide/troubleshooting/faq.html>

  *

    Meta

      o Glossary <https://ontop-vkg.org/guide/glossary.html>
      o Release notes <https://ontop-vkg.org/guide/releases.html>


  # <#command-line-interface> Command Line Interface

Ontop ships a shell script (|ontop| for *nix) and a bat file (|
ontop.bat| for Windows) exposing the core functionality and several
utilities through the command line interface. It is an easy way to get
the system quickly set-up, test for correct execution, and query or
materialize as needed.

  * Setup <#setup-ontop-cli>
  * ontop endpoint <#ontop-endpoint>
  * ontop materialize <#ontop-materialize>
  * ontop mapping <#ontop-mapping>
  * ontop bootstrap <#ontop-bootstrap>
  * ontop query <#ontop-query>
  * ontop extract-db-metadata <#ontop-extract-db-metadata>


    # <#setup-ontop-cli> Setup Ontop CLI

First, you have to download Ontop latest CLI zip from our download pages
(Github(opens new window) <https://github.com/ontop/ontop/releases> or
Sourceforge(opens new window) <https://sourceforge.net/projects/
ontop4obda/files/>). Unzip it in a folder. Open the command line
terminal and cd to that folder. For Windows use the |ontop.bat| file,
for Linux and OS X use the |ontop| file.

|$ ./ontop help
usage: ontop <command> [ <args> ]

Commands are:
    --version             Show version of ontop
    bootstrap             Bootstrap ontology and mapping from the database
    endpoint              Start a SPARQL endpoint powered by Ontop
    extract-db-metadata   Extract the DB metadata and serialize it into an output JSON file
    help                  Display help information
    materialize           Materialize the RDF graph exposed by the mapping and the OWL ontology
    query                 Query the RDF graph exposed by the mapping and the OWL ontology
    validate              Validate Ontology and Mappings
    mapping               Manipulate mapping files
|


      # <#jdbc-configuration> JDBC configuration

JDBC drivers are software implemented by third parties (often the same
developers of the database system) that handle interaction with the
database in their own proprietary protocols. You will need to manually
download the JDBC drivers for your database management system (e.g.,
PostgreSQL JDBC drivers(opens new window) <https://jdbc.postgresql.org/
>) and put them into the |jdbc| directory.


      # <#path> PATH

Consider putting the directory of ontop to your |PATH|.


      # <#logging-level> Logging level

It can be set using the environment variable |ONTOP_LOG_LEVEL|. Set it
to |DEBUG| to get most details, including generated SQL queries.
Alternatively, you can change the value of the |level| attribute of the
|root| element at the end of the file |log/logback.xml|.


      # <#property-file> Property file

Most commands below require or accept as input a property file. This is
where you will specify the JDBC connection parameters. A basic property
file template can be found here <https://ontop-vkg.org/properties/
basic.properties>.


    # <#ontop-endpoint> |ontop endpoint|

|ontop endpoint| deploys a SPARQL endpoint locally at the address |/
sparql| and by default on the port 8080. It powers our official
Docker(opens new window) <https://hub.docker.com/r/ontop/ontop>, so feel
free to use the Docker image instead of the CLI command if it is more
convenient for you.

It offers several advanced options:

  * /Lazy initialization:/ Ontop offline tasks (such as DB metadata
    extraction and mapping processing) are triggered after receiving the
    first SPARQL query. This is useful when using a Docker-Compose with
    Ontop and a DB image that needs to be initialized first.
  * /Development mode (since 4.0-beta-1):/ restarts the endpoint every
    time the configuration files are changed. It also exposes a GET/POST
    method |/ontop/reformulate| accepting a SPARQL query as param as any
    SPARQL endpoint but returning the reformulated SQL query as result.
  * /Portal (since 4.0-beta-1):/ Includes groups of pre-defined SPARQL
    queries into the welcome page. See the following example of portal
    file <https://ontop-vkg.org/examples/example-portal.toml> in the
    TOML format.
  * /Predefined query endpoint <https://ontop-vkg.org/guide/advanced/
    predefined> (since 4.1.0)/
  * /Ontology made downloadable (since 4.2.0)/.

|$ ./ontop help endpoint
NAME
        ontop endpoint - Start a SPARQL endpoint powered by Ontop

SYNOPSIS
        ontop endpoint [ {-a | --facts} <fact file> ]
                [ {-c | --constraint} <constraint file> ]
                [ --contexts <JSON-LD context file for predefined queries> ]
                [ --cors-allowed-origins <origins> ]
                [ {-d | --db-metadata} <db-metadata file> ]
                [ --db-driver <DB driver> ] [ --db-password <DB password> ]
                [ --db-url <DB URL> ] [ --dev ] [ --disable-portal-page ]
                [ --enable-annotations ] [ --enable-download-ontology ]
                [ --facts-base-iri <Base IRI of facts in fact file> ]
                [ --facts-format <format of facts file> ]
                [ {-l | --lenses | -v | --ontop-views} <lenses file> ]
                [ --lazy ] {-m | --mapping} <mapping file>
                [ {-p | --properties} <properties file> ] [ --port <port> ]
                [ --portal <endpoint portal file> ]
                [ --predefined-config <predefined query JSON config file> ]
                [ --predefined-queries <predefined query TOML file> ]
                [ --sparql-rules <SPARQL rules file> ]
                [ {-t | --ontology} <ontology file> ]
                [ {-u | --db-user} <DB user> ]
                [ {-x | --xml-catalog} <xml catalog file> ]

OPTIONS
        -a <fact file>, --facts <fact file>
            User-supplied constant fact file

        -c <constraint file>, --constraint <constraint file>
            User-supplied DB constraint file

        --contexts <JSON-LD context file for predefined queries>
            File containing JSON-LD contexts for predefined queries

        --cors-allowed-origins <origins>
            CORS allowed origins

        -d <db-metadata file>, --db-metadata <db-metadata file>
            User-supplied db-metadata file

        --db-driver <DB driver>
            DB driver (overrides the properties)

        --db-password <DB password>
            DB password (overrides the properties)

        --db-url <DB URL>
            DB URL (overrides the properties)

        --dev
            development mode

        --disable-portal-page
            Disable the portal page (/index.html) of the SPARQL endpoint.

        --enable-annotations
            enable annotation properties defined in the ontology. Default:
            false

        --enable-download-ontology
            Allow to download the ontology as a plain text file (/ontology).
            Default: false

        --facts-base-iri <Base IRI of facts in fact file>
            The base IRI used for the facts taken from the fact file.

        --facts-format <format of facts file>
            The format of the materialized ontology. Default: infer from file extension

            This options value is restricted to the following set of values:
                rdfxml
                turtle
                ntriples
                nquads
                trig
                jsonld

        -l <lenses file>, --lenses <lenses file>, -v <lenses file>,
        --ontop-views <lenses file>
            User-supplied lenses file. Lenses were formerly named Ontop views.

        --lazy
            lazy initialization

        -m <mapping file>, --mapping <mapping file>
            Mapping file in R2RML (.ttl) or in Ontop native format (.obda)

        -p <properties file>, --properties <properties file>
            Properties file

        --port <port>
            port of the SPARQL endpoint

        --portal <endpoint portal file>
            endpoint portal file (including title and queries)

        --predefined-config <predefined query JSON config file>
            predefined query config file

            This option is required if any of the following options are
            specified: --predefined-queries


        --predefined-queries <predefined query TOML file>
            predefined SPARQL queries file

            This option is required if any of the following options are
            specified: --predefined-config


        --sparql-rules <SPARQL rules file>
            User-supplied SPARQL rules file

        -t <ontology file>, --ontology <ontology file>
            OWL ontology file

        -u <DB user>, --db-user <DB user>
            DB user (overrides the properties)

        -x <xml catalog file>, --xml-catalog <xml catalog file>
            XML Catalog file (e.g. catalog-v001.xml generated by Protege) for
            redirecting ontologies imported by owl:imports
|


      # <#example> Example

|$ ./ontop endpoint -m university-complete.obda \
                   -t university-complete.ttl \
                   -p university-complete.properties \
                   --cors-allowed-origins=*
|


    # <#ontop-materialize> |ontop materialize|

This command provides a "materialization utility". Materialization is
helpful when you want to generate RDF data out of your database, using
the provided mappings. This utility will take all the triples that the
mapping can produce from the data source, and write them to the output.
|ontop materialize| does not need any query file, but instead, needs the
user to specify a format in which he/she wants the output (either to
terminal or output file). The user can choose between three output
formats: Turtle(opens new window) <https://www.w3.org/TR/2014/REC-
turtle-20140225/>, N-triples(opens new window) <https://www.w3.org/
TR/2014/REC-n-triples-20140225/> or RDF/XML(opens new window) <https://
www.w3.org/TR/2014/REC-rdf-syntax-grammar-20140225/>. For very large
datasets, producing the output might take some time.

The compression option has been added in 5.2.0.

|$ ./ontop help materialize
NAME
        ontop materialize - Materialize the RDF graph exposed by the mapping
        and the OWL ontology

SYNOPSIS
        ontop materialize [ {-a | --facts} <fact file> ]
                [ {-c | --constraint} <constraint file> ]
                [ --compression <output compression> ]
                [ {-d | --db-metadata} <db-metadata file> ]
                [ --db-driver <DB driver> ] [ --db-password <DB password> ]
                [ --db-url <DB URL> ] [ --enable-annotations ]
                [ {-f | --format} <output format> ]
                [ --facts-base-iri <base IRI of facts in fact file> ]
                [ --facts-format <format of facts file> ]
                [ {-l | --lenses | -v | --ontop-views} <Lenses file> ]
                {-m | --mapping} <mapping file> [ --no-streaming ]
                [ {-o | --output} <output> ]
                [ {-p | --properties} <properties file> ] [ --separate-files ]
                [ --sparql-rules <SPARQL rules file> ]
                [ {-t | --ontology} <ontology file> ]
                [ {-u | --db-user} <DB user> ]
                [ {-x | --xml-catalog} <xml catalog file> ]

OPTIONS
        -a <fact file>, --facts <fact file>
            RDF fact file

        -c <constraint file>, --constraint <constraint file>
            User-supplied DB constraint file

        --compression <output compression>
            The compression format of the materialized RDF graph. Default: no
            compression

            This options value is restricted to the following set of values:
                gzip
                zip
                no_compression

        -d <db-metadata file>, --db-metadata <db-metadata file>
            User-supplied db-metadata file

        --db-driver <DB driver>
            DB driver (overrides the properties)

        --db-password <DB password>
            DB password (overrides the properties)

        --db-url <DB URL>
            DB URL (overrides the properties)

        --enable-annotations
            enable annotation properties defined in the ontology. Default:
            false

        -f <output format>, --format <output format>
            The format of the materialized RDF graph. Default: rdfxml

            This options value is restricted to the following set of values:
                rdfxml
                turtle
                ntriples
                nquads
                trig
                jsonld

        --facts-base-iri <base IRI of facts in fact file>
            The base IRI of facts in the fact file to resolve relative IRIs. If
            not provided, a random IRI is generated.

        --facts-format <format of facts file>
            The format of the 'facts' input file.

            This options value is restricted to the following set of values:
                rdfxml
                turtle
                ntriples
                nquads
                trig
                jsonld

        -l <Lenses file>, --lenses <Lenses file>, -v <Lenses file>,
        --ontop-views <Lenses file>
            User-supplied lenses file. Lenses were formerly named Ontop views.

        -m <mapping file>, --mapping <mapping file>
            Mapping file in R2RML (.ttl) or in Ontop native format (.obda)

        --no-streaming
            All the SQL results of one big query will be stored in memory. Not
            recommended. Default: false.

        -o <output>, --output <output>
            output file (default) or prefix (only for --separate-files)

        -p <properties file>, --properties <properties file>
            Properties file

        --separate-files
            generating separate files for different classes/properties. This is
            useful for materializing large OBDA setting. Default: false.

        --sparql-rules <SPARQL rules file>
            User-supplied SPARQL rules file

        -t <ontology file>, --ontology <ontology file>
            OWL ontology file

        -u <DB user>, --db-user <DB user>
            DB user (overrides the properties)

        -x <xml catalog file>, --xml-catalog <xml catalog file>
            XML Catalog file (e.g. catalog-v001.xml generated by Protege) for
            redirecting ontologies imported by owl:imports
|


      # <#examples> Examples

|$ ./ontop materialize -m university-complete.obda \
                      -t university-complete.ttl \
                      -p university-complete.properties \
                      -f turtle \
                      -o materialized-triples.ttl
|

In case you have some lenses:

|$ ./ontop materialize -m mapping.ttl \
                      -t ontology.ttl \
                      -l lenses.json \
                      -p configuration.properties \
                      -f turtle \
                      -o materialized-triples.ttl
|


    # <#ontop-mapping> |ontop mapping|

This command collects several useful sub-commands for dealing with
mappings files.

|$ ./ontop help mapping
NAME
        ontop mapping - Manipulate mapping files

SYNOPSIS
        ontop mapping { pretty-r2rml | to-obda | to-r2rml | v1-to-v3 } [--]
                [cmd-options]

        Where command-specific options [cmd-options] are:
            pretty-r2rml: {-i | --input} <input.ttl> {-o | --output}
                    <pretty.ttl>
            to-obda: {-i | --input} <mapping.ttl> [ {-o | --output} <mapping.obda> ]
            to-r2rml: [ {-l | --lenses | -v | --ontop-views} <lenses file> ] [ {-t | --ontology} <ontology.owl> ]
                    {-i | --input} <mapping.obda> [ {-o | --output} <mapping.ttl> ]
                    [ {-p | --properties} <properties file> ] [ {-d | --db-metadata} <db-metadata file> ]
                    [ --force ]
            v1-to-v3: [ --simplify-projection ] {-m | --mapping} <mapping file>
                    [ --overwrite ] [ {-o | --output} <mapping.obda> ]

        See 'ontop help mapping <command>' for more information on a specific command.
|


      # <#ontop-mapping-to-r2rml> |ontop mapping to-r2rml|

Supports automatically converting mappings from Ontop native format
(|.obda|) to the R2RML(opens new window) <http://www.w3.org/TR/2012/REC-
r2rml-20120927/> standard format. Since 4.1.0, by default, it expects DB
credentials (for extracting the DB metadata) or a DB metadata file. This
requirement can be bypassed using the option |--force|.

|$ ./ontop help mapping to-r2rml
NAME
        ontop mapping to-r2rml - Convert ontop native mapping format (.obda) to
        R2RML format

SYNOPSIS
        ontop mapping to-r2rml [ {-d | --db-metadata} <db-metadata file> ]
                [ --force ] {-i | --input} <mapping.obda>
                [ {-l | --lenses | -v | --ontop-views} <lenses file> ]
                [ {-o | --output} <mapping.ttl> ]
                [ {-p | --properties} <properties file> ]
                [ {-t | --ontology} <ontology.owl> ]

OPTIONS
        -d <db-metadata file>, --db-metadata <db-metadata file>
            User-supplied db-metadata file

        --force
            Force the conversion in the absence of DB metadata

        -i <mapping.obda>, --input <mapping.obda>
            Input mapping file in Ontop native format (.obda)

        -l <lenses file>, --lenses <lenses file>, -v <lenses file>,
        --ontop-views <lenses file>
            User-supplied lenses file. Lenses were formerly named Ontop views.

        -o <mapping.ttl>, --output <mapping.ttl>
            Output mapping file in R2RML format (.ttl)

        -p <properties file>, --properties <properties file>
            Properties file

        -t <ontology.owl>, --ontology <ontology.owl>
            OWL ontology file
|


      # <#ontop-mapping-to-obda> |ontop mapping to-obda|

Supports automatically converting mappings from R2RML(opens new window)
<http://www.w3.org/TR/2012/REC-r2rml-20120927/> standard format to Ontop
native format (|.obda|):

|$ ./ontop help mapping to-obda
NAME
        ontop mapping to-obda - Convert R2RML format to ontop native mapping
        format (.obda)

SYNOPSIS
        ontop mapping to-obda {-i | --input} <mapping.ttl>
                [ {-o | --output} <mapping.obda> ]

OPTIONS
        -i <mapping.ttl>, --input <mapping.ttl>
            Input mapping file in R2RML format (.ttl)

        -o <mapping.obda>, --output <mapping.obda>
            Output mapping file in Ontop native format (.obda)
|


      # <#ontop-mapping-pretty-r2rml> |ontop mapping pretty-r2rml|

Provides automatic formatting and prettifying facilities for mappings files:

|$ ./ontop help mapping pretty-r2rml
NAME
        ontop mapping pretty-r2rml - prettify R2RML file using Jena

SYNOPSIS
        ontop mapping pretty-r2rml {-i | --input} <input.ttl>
                {-o | --output} <pretty.ttl>

OPTIONS
        -i <input.ttl>, --input <input.ttl>
            Input mapping file in the turtle R2RML format (.ttl)

        -o <pretty.ttl>, --output <pretty.ttl>
            Output mapping file in the turtle R2RML format (.ttl)
|


    # <#ontop-bootstrap> |ontop bootstrap|

This command allows the automatic generation of mappings and ontology
starting from a database schema. The generated output can be used as-is
or further customized manually (e.g., to used different ontological
modeling choices and corresponding mappings). In both cases, it helps
substantially reducing the user effort involved in setting up the
ontology and mappings of a VKG specification.

|$ ./ontop help bootstrap
NAME
        ontop bootstrap - Bootstrap ontology and mapping from the database

SYNOPSIS
        ontop bootstrap {-b | --base-iri} <base IRI>
                [ --db-driver <DB driver> ] [ --db-password <DB password> ]
                [ --db-url <DB URL> ] {-m | --mapping} <mapping file>
                [ {-p | --properties} <properties file> ]
                {-t | --ontology} <ontology file>
                [ {-u | --db-user} <DB user> ]

OPTIONS
        -b <base IRI>, --base-iri <base IRI>
            Base IRI of the generated mapping

        --db-driver <DB driver>
            DB driver (overrides the properties)

        --db-password <DB password>
            DB password (overrides the properties)

        --db-url <DB URL>
            DB URL (overrides the properties)

        -m <mapping file>, --mapping <mapping file>
            Output mapping file in the Ontop native format (.obda)

        -p <properties file>, --properties <properties file>
            Properties file

        -t <ontology file>, --ontology <ontology file>
            Output OWL ontology file

        -u <DB user>, --db-user <DB user>
            DB user (overrides the properties)
|


    # <#ontop-query> |ontop query|

The |ontop query| command is designed for helping users to test their
system quickly using the command line utilities. You can use this
command if you already have a scenario test case including:

  * the ontology (RDFS or OWL) and the mappings (obda or R2RML) files,
  * a working database to connect to,
  * a SPARQL query file

The |ontop query| command helps you to set up the system, runs the query
from the query string file over it, and gets the results either in
output file or terminal output. What the script actually does is to set
up Ontop using the ontology and the mapping files, parse the query from
the file and execute it over the created instance of Ontop.

Note that |ontop query| is NOT intended to be used in production and for
benchmarking purposes. Most of its execution time is dedicated to
offline tasks like DB metadata extraction and mapping processing. Query
answering (i.e. answering the SPARQL query) takes usually much less
time. For production and benchmarking purposes, please consider
deploying Ontop as a SPARQL endpoint <#ontop-endpoint>.

The results are turned in the CSV format.

WARNING

At the moment only SELECT queries are supported by this command. See
#222(opens new window) <https://github.com/ontop/ontop/issues/222>.

|$ ./ontop help query
NAME
        ontop query - Query the RDF graph exposed by the mapping and the OWL
        ontology

SYNOPSIS
        ontop query [ {-a | --facts} <fact file> ]
                [ {-c | --constraint} <constraint file> ]
                [ {-d | --db-metadata} <db-metadata file> ]
                [ --db-driver <DB driver> ] [ --db-password <DB password> ]
                [ --db-url <DB URL> ] [ --enable-annotations ]
                [ --facts-base-iri <Base IRI of facts in fact file> ]
                [ --facts-format <format of facts file> ]
                [ {-l | --lenses | -v | --ontop-views} <lenses file> ]
                {-m | --mapping} <mapping file> [ {-o | --output} <output> ]
                [ {-p | --properties} <properties file> ]
                {-q | --query} <queryFile>
                [ --sparql-rules <SPARQL rules file> ]
                [ {-t | --ontology} <ontology file> ]
                [ {-u | --db-user} <DB user> ]
                [ {-x | --xml-catalog} <xml catalog file> ]

OPTIONS
        -a <fact file>, --facts <fact file>
            User-supplied constant fact file

        -c <constraint file>, --constraint <constraint file>
            User-supplied DB constraint file

        -d <db-metadata file>, --db-metadata <db-metadata file>
            User-supplied db-metadata file

        --db-driver <DB driver>
            DB driver (overrides the properties)

        --db-password <DB password>
            DB password (overrides the properties)

        --db-url <DB URL>
            DB URL (overrides the properties)

        --enable-annotations
            enable annotation properties defined in the ontology. Default:
            false

        --facts-base-iri <Base IRI of facts in fact file>
            The base IRI used for the facts taken from the fact file.

        --facts-format <format of facts file>
            The format of the materialized ontology. Default: infer from file extension

            This options value is restricted to the following set of values:
                rdfxml
                turtle
                ntriples
                nquads
                trig
                jsonld

        -l <lenses file>, --lenses <lenses file>, -v <lenses file>,
        --ontop-views <lenses file>
            User-supplied lenses file. Lenses were formerly named Ontop views.

        -m <mapping file>, --mapping <mapping file>
            Mapping file in R2RML (.ttl) or in Ontop native format (.obda)

        -o <output>, --output <output>
            output file in the CSV format. If not specified, will print the
            results in the standard output.

        -p <properties file>, --properties <properties file>
            Properties file

        -q <queryFile>, --query <queryFile>
            SPARQL SELECT query file

        --sparql-rules <SPARQL rules file>
            User-supplied SPARQL rules file

        -t <ontology file>, --ontology <ontology file>
            OWL ontology file

        -u <DB user>, --db-user <DB user>
            DB user (overrides the properties)

        -x <xml catalog file>, --xml-catalog <xml catalog file>
            XML Catalog file (e.g. catalog-v001.xml generated by Protege) for
            redirecting ontologies imported by owl:imports
|


      # <#example-1> Example 1

Execute a SPARQL query using Ontop mappings.

|$  ./ontop query -m university-complete.obda \
                 -t university-complete.owl \
                 -p university-complete.properties \
                 -q q1.txt

x
http://www.Department0.University0.edu/GraduateStudent44
http://www.Department0.University0.edu/GraduateStudent101
http://www.Department0.University0.edu/GraduateStudent124
http://www.Department0.University0.edu/GraduateStudent142
|

where |q1.txt| contains the SPARQL query, e.g.:

|PREFIX : <http://example.org/voc#>
SELECT ?x { ?x a :GraduateStudent . }
|


      # <#example-2> Example 2

Execute a SPARQL query using R2RML mappings and output the query result
to a file.

|$ ./ontop query -m university-complete.ttl \
                -t university-complete.owl \
                -p university-complete.properties \
                -q q1.txt \
                -o q1.csv

$ cat q1.csv
x
http://www.Department0.University0.edu/GraduateStudent44
http://www.Department0.University0.edu/GraduateStudent101
http://www.Department0.University0.edu/GraduateStudent124
http://www.Department0.University0.edu/GraduateStudent142
|


    # <#ontop-extract-db-metadata> |ontop extract-db-metadata|

/Stable since 4.1.0/.

This command extracts the metadata from the database and serializes it
into a JSON file. This file can later on be passed as an argument to
many other commands.

|$ ./ontop help extract-db-metadata
NAME
        ontop extract-db-metadata - Extract the DB metadata and serialize it
        into an output JSON file

SYNOPSIS
        ontop extract-db-metadata [ {-o | --output} <output> ]
                {-p | --properties} <properties file>

OPTIONS
        -o <output>, --output <output>
            output file

        -p <properties file>, --properties <properties file>
            Properties file
|


      # <#example-3> Example

|$ ./ontop extract-db-metadata -p mobility.properties -o db-metadata.json
|

|{
  "relations" : [ {
    "uniqueConstraints" : [ {
      "name" : "metadata_pkey",
      "determinants" : [ "\"id\"" ],
      "isPrimaryKey" : true
    } ],
    "foreignKeys" : [ {
      "name" : "fk_metadata_station_id_station_pk",
      "from" : {
        "relation" : [ "\"mobility\"", "\"metadata\"" ],
        "columns" : [ "\"station_id\"" ]
      },
      "to" : {
        "relation" : [ "\"mobility\"", "\"station\"" ],
        "columns" : [ "\"id\"" ]
      }
    } ],
    "columns" : [ {
      "name" : "\"id\"",
      "isNullable" : false,
      "datatype" : "bigserial"
    }, {
      "name" : "\"created_on\"",
      "isNullable" : true,
      "datatype" : "timestamp"
    }, {
      "name" : "\"json\"",
      "isNullable" : true,
      "datatype" : "jsonb"
    }, {
      "name" : "\"station_id\"",
      "isNullable" : true,
      "datatype" : "int8"
    } ],
    "name" : [ "\"mobility\"", "\"metadata\"" ]
  },
  {
    "uniqueConstraints" : [ {
      "name" : "station_pkey",
      "determinants" : [ "\"id\"" ],
      "isPrimaryKey" : true
    }, {
      "name" : "uc_station_stationcode_stationtype",
      "determinants" : [ "\"stationcode\"", "\"stationtype\"" ],
      "isPrimaryKey" : false
    } ],
    "columns" : [ {
      "name" : "\"id\"",
      "isNullable" : false,
      "datatype" : "bigserial"
    }, {
      "name" : "\"name\"",
      "isNullable" : false,
      "datatype" : "varchar(255)"
    }, {
      "name" : "\"stationtype\"",
      "isNullable" : false,
      "datatype" : "varchar(255)"
    } ],
    "name" : [ "\"mobility\"", "\"station\"" ]
  } ],
  "metadata" : {
    "dbmsProductName" : "PostgreSQL",
    "dbmsVersion" : "13.1",
    "driverName" : "PostgreSQL JDBC Driver",
    "driverVersion" : "42.2.8",
    "quotationString" : "\"",
    "extractionTime" : "2021-02-25T15:56:09",
    "idFactoryType" : "POSTGRESQL"
  }
}
|

Edit this page <https://github.com/ontop/ontop-website/edit/master/
guide/cli.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Getting started <https://ontop-vkg.org/guide/getting-started.html>
Standards compliance <https://ontop-vkg.org/guide/compliance.html> →
```

## File: Configuration keys _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Guide

      o Introduction <https://ontop-vkg.org/guide/>
      o Key concepts <https://ontop-vkg.org/guide/concepts.html>
      o Getting started <https://ontop-vkg.org/guide/getting-started.html>
      o Command Line Interface <https://ontop-vkg.org/guide/cli.html>
      o Standards compliance <https://ontop-vkg.org/guide/compliance.html>

  *

    Advanced

      o Ontop Mapping Language <https://ontop-vkg.org/guide/advanced/
        mapping-language.html>
      o Predefined query endpoint (beta) <https://ontop-vkg.org/guide/
        advanced/predefined.html>
      o Query logging <https://ontop-vkg.org/guide/advanced/logging.html>
      o HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
      o Configuration keys <https://ontop-vkg.org/guide/advanced/
        configuration.html>
      o Lenses <https://ontop-vkg.org/guide/advanced/lenses.html>

  *

    Data sources

  *

    Troubleshooting

      o FAQ <https://ontop-vkg.org/guide/troubleshooting/faq.html>

  *

    Meta

      o Glossary <https://ontop-vkg.org/guide/glossary.html>
      o Release notes <https://ontop-vkg.org/guide/releases.html>


  # <#configuration-keys> Configuration keys

Here is a list of the configuration keys which can be set in the
properties file.

Key 	Type 	Description
|ontop.cardinalityMode| 	Enum 	

Default value: |STRICT|. If set to |LOOSE|, the cardinality is not
guaranteed to be preserved anymore.

|ontop.testMode| 	Boolean 	

Default value: |false|. If true, performs extra checks. Should not be
enabled in production.

|ontop.maxNbChildrenLiftingDBFS| 	Integer 	

Default value: |10|. Above this threshold, the preference for a function
symbol to be post-processed is not considered.

|ontop.sameAs| 	Boolean 	

Default value: |false|. If true, enforces the owl:sameAs semantics at
the mapping level. Not very efficient, please consider using canonical
IRIs instead. See https://ontop-vkg.org/tutorial/mapping/uri-
templates#canonical-iris <https://ontop-vkg.org/tutorial/mapping/uri-
templates#canonical-iris>

|jdbc.url| 	IRI 	

JDBC URL for connecting the database. The username and the password are
not expected to be specified in this URL.

|jdbc.driver| 	String 	

Canonical name of the JDBC driver class.

|jdbc.user| 	String 	

Username for connecting to the database.

|jdbc.password| 	String 	

Password for connecting to the database.

|jdbc.property.<KEY>| 	Any 	

Since 5.0.2. Passes the property |<KEY>| and its value to the JDBC
driver. Useful for passing secrets to the JDBC driver with other keys
than |user| and |password|.

|jdbc.name| 	String 	

DEPRECATED. This value is ignored.

|jdbc.fetchSize| 	Integer 	

If more than 1, fetch the results by batches of the specified size.
Otherwise, relies on the default configuration of the JDBC driver.
Default value: 500 for query answering, 50000 for materialization.

|jdbc.pool.connectionTimeout| 	Integer 	

Default value: 30000. The maximum number of milliseconds that the pool
will wait (when there are no available connections) for a connection to
be returned before throwing an exception.

|jdbc.pool.initialSize| 	Integer 	

Default value: 2. The number of connections that will be established
when the connection pool is started.

|jdbc.pool.maxSize| 	Integer 	

Default value: 20. The maximum number of active connections that can be
allocated from the pool at the same time.

|jdbc.pool.keepAlive| 	Boolean 	

Default value: true. If true, sets a validation query to make sure
connection is alive but sending the query.

|jdbc.pool.removeAbandoned| 	Boolean 	

Default value: false. If true, removes abandoned connections from the pool.

|jdbc.initScript| 	String 	

Since 5.3.1. If present, the script is executed each time a connection
to the database is created. Note that Ontop may open multiple
connections to the database.

|ontop.queryOntologyAnnotation| 	Boolean 	

Default value: |false|. If true, includes annotations about classes and
properties in the virtual graph.

|ontop.inferDefaultDatatype| 	Boolean 	

Default value: |false|. If false, throws an exception if the system is
not able to infer the datatype from the database. If true, uses the
default datatype (xsd:string).

|ontop.tolerateAbstractDatatype| 	Boolean 	

Default value: |false|. If false, throws an exception is an abstract
datatype is used for a literal in a mapping assertion. If true, abstract
datatypes will be replaced by concrete ones.

|ontop.isCanonicalIRIComplete| 	Boolean 	

Default value: |true|. Let S be the data source, and if M is a set of
mapping assertions, let M(S) be the graph derived by applying M to S
(without ontology). And let dom(M(S)) (resp. range(M(S))) be all
subjects (resp. objects) of some triple in M(S). Now let C be all
mapping assertions with isCanonicalIRIOf as predicate, and let A_sub
(resp(A_obj)) be all mapping assertions whose subject (resp. object) is
built with a URI template, and whose predicate is not isCanonicalIRIOf.
If this parameter is set to |true|, then for any a in A_sub, either
dom({a}(S)) \cap range(C(S)) = \emptyset, or dom({a}(S)) \subseteq
range(C(S))). Similarly, for any a in A_obj, either range({a}(S)) \cap
range(C(S)) = \emptyset, or range({a}(S)) \subseteq range(C(S))).

|ontop.allowRetrievingBlackBoxViewMetadataFromDB| 	Boolean 	

Since 4.2.0. Default value: |false|. If |true|, the column names of
black-box views and their data types are retrieved by querying the
database. If |false|, data types remain unknown and the extraction of
column names is unsafe.

|ontop.ignoreInvalidMappingEntries| 	Boolean 	

Since 5.1.0. Default value: |false|. If |true|, mapping entries that
result in an error will be ignored instead of failing the initialization
procedure.

|ontop.ignoreInvalidLensEntries| 	Boolean 	

Since 5.1.0. Default value: |false|. If |true|, lens entries that result
in an error will be created as empty instead of failing the
initialization procedure. Expected to be used together with |
ontop.ignoreInvalidMappingEntries|.

|ontop.exposeSystemTables| 	Boolean 	

Since 5.1.0. Default value: |false|. If |true|, system tables of the
database system will be made accessible for Ontop.

|ontop.enableValuesNode| 	Boolean 	

REMOVED from 5.2.0 (introduced in 4.2.0). Default value: |true|. If
false Union Nodes are used instead of Values Nodes for facts.

|ontop.enableFactExtractionWithTBox| 	Boolean 	

Since 4.2.0. Default value: |false|. If |true|, saturated tbox will be
used to extract facts in addition to the explicit ontology facts.

|ontop.querySuperClassesOfDomainRange| 	Boolean 	

Since 4.2.0. Default value: |true|. If |false|, no additional facts on
superclasses for rdfs:domain/range are integrated in addition to the
explicit ontology facts.

|ontop.disableLimitOptimization| 	Boolean 	

Since 5.0.0. Default value: |false|. If |true|, most limit optimizations
won't be applied.

|mapping.baseIri| 	IRI 	

See http://www.w3.org/TR/r2rml/#dfn-base-iri <http://www.w3.org/TR/
r2rml/#dfn-base-iri>

|ontop.existentialReasoning| 	Boolean 	

Default value: |false|. If true, rewrites the SPARQL query using the
tree witnesses technique.

|ontop.distinctResultSet| 	Boolean 	

REMOVED from 4.2.0. Default value: |false|. If true, performs a post-
processing operation removing duplicates from the result set,
independently from the query.

|ontop.avoidPostProcessing| 	Boolean 	

Default value: |false|. If true, maximizes the processing done by the
SQL query.

|ontop.reformulateToFullNativeQuery| 	Boolean 	

Since 5.0.0. Default value: |false|. If true, fully translates SPARQL
queries into native (e.g. SQL) queries, with the same column names and
their corresponding natural DB data types. Rejects SPARQL queries that
are not strongly-typed.

|ontop.excludeInvalidTriplesFromResultSet| 	Boolean 	

Default value: |false|. If false, makes the query fail when an invalid
triple is detected.

|ontop.cache.query.size| 	Integer 	

Default value: |1000|. Maximum size for the internal query cache for
bypassing query reformulation.

|ontop.queryLogging| 	Boolean 	

Default value: |false|. If true, enables query logging.

|ontop.applicationName| 	String 	

Default value: |Ontop|. Application name appearing in the query log.

|ontop.queryLogging.includeSparqlQuery| 	Boolean 	

Includes the SPARQL query string into the query log.

|ontop.queryLogging.includeReformulatedQuery| 	Boolean 	

Includes the reformulated query into the query log.

|ontop.queryLogging.includeClassesAndProperties| 	Boolean 	

Includes classes and properties into the query log.

|ontop.queryLogging.includeTables| 	Boolean 	

Includes DB tables/views into the query log.

|ontop.queryLogging.includeUserInfo| 	Boolean 	

Since 5.2.0. Default value: |false|. If |true|, includes the user ID,
his/her groups and roles.

|ontop.queryLogging.includeHttpHeader.HEADER_NAME| 	Boolean 	

If true, includes a specific HTTP header (please replace |HEADER_NAME|
by the desired one) into the query log.

|ontop.queryLogging.extractQueryTemplate| 	Boolean 	

Default value: |false|. If true, extracts a query template and constants
out of the SPARQL query. Allows to recognize queries generated from the
same template.

|ontop.queryLogging.decomposition| 	Boolean 	

Default value: |false|. If true, outputs multiple log entries per query
(after decomposition, after receiving the first result, after receiving
all the results).

|ontop.queryLogging.decompositionAndMergingMutuallyExclusive| 	Boolean 	

Default value: |true|. If true, either outputs an unique log entry per
query or, if the decomposition is enabled, log entries per query (after
decomposition, after receiving the first result, after receiving all the
results, but not the version including all the keys.

|ontop.includeFixedObjectPositionInDescribe| 	Boolean 	

Default value: |false|. If true, the pattern |?s ?p <to_describe>| is
also considered when answering a DESCRIBE query.

|ontop.registerCustomSPARQLAggregateFunctions| 	Boolean 	

Default value: |true|. If true, Ontop's custom aggregate functions are
registered in the RDF4J SPARQL parser's aggregate function registry.

|ontop.query.defaultTimeout| 	Integer 	

Query timeout (in seconds) assigned to the DB engine. Has no effect if
negative or equal to 0.

|ontop.permanentConnection| 	Boolean 	

Needed by some in-memory DBs (e.g. an H2 DB storing a semantic index).

|ontop.http.cacheControl| 	String 	

Value to assign to the HTTP header Cache-Control in case of success. See
https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control
<https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control>

|ontop.http.cache.maxAge| 	Integer 	

DEPRECATED. Please use |ontop.http.cacheControl| instead.

|ontop.http.cache.staleWhileRevalidate| 	Integer 	

DEPRECATED. Please use |ontop.http.cacheControl| instead.

|ontop.http.cache.staleIfError| 	Integer 	

DEPRECATED. Please use |ontop.http.cacheControl| instead.

|ontop.authorization| 	Boolean 	

Since 5.2.0. Default value: |false|. If true, extracts user, group and
role information from HTTP headers.

|ontop.wrapMappingValuesNodesInLenses| 	Boolean 	

Since 5.2.0. Default value: |false|. If true, values nodes found in the
mapping may be wrapped into lenses.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
guide/advanced/configuration.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
Lenses <https://ontop-vkg.org/guide/advanced/lenses.html> →
```

## File: Flatten Lens _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#flatten-lens> Flatten Lens

/Flatten lenses are supported since 5.1.0./

Flattening or unnesting an array is the process of transforming a nested
array into an array of lower dimensionality, by "pulling" each nested
entry into its "outer" entry. In databases, specifically, it represents
a function that takes a column containing an array and transforms it
into a table that has each of the /outer-most/ elements as one of its rows.

Flattening is need when we want to map values inside arrays.

In Ontop, a flatten lens is a type of lens over a single base relation
that takes as an input the column that should be flattened, the names of
columns that should be retained after flattening, and the name of the
column that should be added containing the flattened output.
Additionally, the name for a /position/ column can be passed to the
lens. When flattening, the /position/ column will hold the index of the
current row's flattened element in the original array.

For this example, we will first look at the table |workers|. This table
has the following schema:

column 	type
worker_id 	integer
full_name 	string
role 	string
museum_id 	integer
titles 	array of strings
access_level 	integer

The column |titles| is an array of strings that contains all the degrees
and titles the employee has received. Our goal is to populate the
datatype properties |:hasTitle| defined from the |:Worker| class to any
number of string literals taken from the table, and |:preferredTitle|,
defined from the |:Worker| class to a single literal, which is the first
entry of the |titles| array. To do so efficiently, we need to flatten
the |titles| column.

The flatten lens has the following structure:

|{
    "name": [String],
    "baseRelation": [String]
    "flattenedColumn": {
        "name": String,
        "datatype": String
    },
    "columns": {
        "kept": [String],
        "new": String,
        "position": String
    },
    "type": "FlattenLens"
}
|

The field |kept| takes a list of column names from the original table
that should be retained after flattening. The field |new| takes the name
of the column that contains the flattened output and the field |
position| takes the name of the column that contains the index of the
current output. The flattened column takes two arguments: |name|
determines the name of the column that should be flattened, and |
datatype| indicates the column's type. Depending on the SQL dialect,
this can vary from |ARRAY<T>| or |T[]| where |T| is a different SQL data
type to |JSON| or |VARCHAR| if arrays are represented and flattened in
JSON format.

In DuckDB, the array data type is defined as |T[]|, so in our specific
case, the field |datatype| will take the value |STRING[]|.

A possible |lenses.json| file for this task may look like this:

|{
    "relations": [
        {
            "name": ["lenses", "flattened_titles"],
            "baseRelation": ["workers"],
            "flattenedColumn": {
                "name": "titles",
                "datatype": "STRING[]"
            },
            "columns": {
                "kept": [
                    "worker_id"
                ],
                "new": "title",
                "position": "index"
            }
        }
    ]
}
|

As we just need to assign a title to a |:Worker| individual, the only
column that has to be kept is |worker_id|.


      # <#mapping> Mapping

Now, we can already define the mapping entries for the wanted properties:

|mappingId	MAPID-has-title
target		data:worker/{worker_id} :hasTitle {title} .
source		SELECT worker_id, title FROM lenses.flattened_titles;

mappingId	MAPID-preferred-title
target		data:worker/{worker_id} :preferredTitle {title} .
source		SELECT worker_id, title FROM lenses.flattened_titles WHERE index = 1;
|

NOTE

Instead of using a source query with a |WHERE| condition in the second
mapping, we could also wrap a basic lens around the flatten lens that
performs the filter operation, but we kept it like this for the sake of
simplicity.

Let us now run a SPARQL query over the Ontop endpoint to test our
mappings and lenses.

|PREFIX : <http://example.org/museum_kg/>
SELECT ?name ?title ?prefTitle WHERE {
    ?worker a :Worker .
    ?worker :name ?name .
    ?worker :hasTitle ?title .
    ?worker :preferredTitle ?prefTitle
}
|

This should result in a list of all employees, together with their
titles and their preferred title.


      # <#flattening-other-types-of-arrays> Flattening other types of arrays

The flatten lens works on all types of arrays, and, depending on the
capabilities of the dialect, can infer the output type of the flattened
column. As a further exercise, try looking at the table |museums|.

column 	type
museum_id 	integer
name 	string
address 	string
yearly_income 	integer
yearly_spendings 	integer
ratings 	array of floats

The field |ratings| is an array of floating point numbers between 1 and
10. Try creating a flatten lens that can unnest this array to populate
the datatype property |:hasRating|! Ontop will be able to automatically
detect that the flattened column has the type |FLOAT|. Keep in mind that
we do not necessarily need a "position" column for this use case.

WARNING

When arrays in a given dialect are defined as |ARRAY<T>|, |T[]|, or
similarly, Ontop is able to infer the data type of the output column
after flattening. However, when this is not the case (either the array
was provided as JSON or the array data type of the dialect is simply
called |ARRAY| or similarly), Ontop cannot perform this inference. In
those cases, it is suggested to put a basic lens over the flatten lens
that explicitly performs a |CAST| on the output, to allow Ontop to know
the column type once again.

WARNING

The level of support for the flatten lens depends strongly on the
dialect. Please consult the flatten lens documentation page <https://
ontop-vkg.org/guide/advanced/lenses.html> for more info on each
supported dialect.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/lenses/flatten-lens.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html> SQL
Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html> →
```

## File: Getting started _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Guide

      o Introduction <https://ontop-vkg.org/guide/>
      o Key concepts <https://ontop-vkg.org/guide/concepts.html>
      o Getting started <https://ontop-vkg.org/guide/getting-started.html>
          + Tutorial <https://ontop-vkg.org/guide/getting-
            started.html#tutorial>
          + Using Ontop <https://ontop-vkg.org/guide/getting-
            started.html#using-ontop>
      o Command Line Interface <https://ontop-vkg.org/guide/cli.html>
      o Standards compliance <https://ontop-vkg.org/guide/compliance.html>

  *

    Advanced

      o Ontop Mapping Language <https://ontop-vkg.org/guide/advanced/
        mapping-language.html>
      o Predefined query endpoint (beta) <https://ontop-vkg.org/guide/
        advanced/predefined.html>
      o Query logging <https://ontop-vkg.org/guide/advanced/logging.html>
      o HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
      o Configuration keys <https://ontop-vkg.org/guide/advanced/
        configuration.html>
      o Lenses <https://ontop-vkg.org/guide/advanced/lenses.html>

  *

    Data sources

  *

    Troubleshooting

      o FAQ <https://ontop-vkg.org/guide/troubleshooting/faq.html>

  *

    Meta

      o Glossary <https://ontop-vkg.org/guide/glossary.html>
      o Release notes <https://ontop-vkg.org/guide/releases.html>


  # <#getting-started> Getting started


    # <#tutorial> Tutorial

If you are new to Ontop and Virtual Knowledge Graphs, we encourage you
to have a look at the official tutorial <https://ontop-vkg.org/tutorial>.


    # <#using-ontop> Using Ontop

Ontop is distributed under various forms. They can be downloaded on
Github(opens new window) <https://github.com/ontop/ontop/releases>,
Docker Hub(opens new window) <https://hub.docker.com/r/ontop/ontop>,
Sourceforge(opens new window) <http://sourceforge.net/projects/
ontop4obda/files/> and in the Protégé plugin repository.


      # <#mapping-designer> Mapping designer

For editing and testing your mappings, you can use our plugin of the
Protégé ontology editor(opens new window) <https://protege.stanford.edu/
>. You can download the latest stable release directly from Protégé.
Alternatively, pre-releases can be found on Github(opens new window)
<https://github.com/ontop/ontop/releases> and Sourceforge(opens new
window) <http://sourceforge.net/projects/ontop4obda/files/>.

Limited support of advanced features

In particular, the Protégé plugin doesn't support lenses <https://ontop-
vkg.org/guide/advanced/lenses>. For advanced usage, we recommend using
text editors or considering commercial offerings.


      # <#deployment> Deployment

Once your mappings and your ontology are ready, you can deploy your VKG
as a SPARQL endpoint. The Ontop endpoint is available both as a CLI
command (|ontop endpoint|) <https://ontop-vkg.org/guide/cli#ontop-
endpoint> and as a Docker image(opens new window) <https://
hub.docker.com/r/ontop/ontop>.

You can also use the Ontop endpoint during development as it embeds a
nice YASGUI client(opens new window) <https://about.yasgui.org/> and an
optional portal (since 4.0-beta-1) containing pre-defined queries.


      # <#command-line-interface> Command Line Interface

Want to materialize your VKG, convert your mappings into R2RML,
bootstrap your mappings or start a SPARQL endpoint? You can use the CLI
<https://ontop-vkg.org/guide/cli> for that. It can be found on on
Github(opens new window) <https://github.com/ontop/ontop/releases> and
Sourceforge(opens new window) <http://sourceforge.net/projects/
ontop4obda/files/>.


      # <#former-solutions> Former solutions

Historically, Ontop has been made available under other means that we
don't recommend anymore.


        # <#java-api-not-recommended> Java API (not recommended)

It remains possible to use Ontop as a Java API through RDF4J(opens new
window) <https://rdf4j.org/> although we recommend the HTTP SPARQL
endpoint as a first option (think of a microservice). Why? Because such
a Java API would add many dependencies to your project and constraint
you to use certain versions of Java.

Ontop-rdf4j is available on Maven Central(opens new window) <https://
search.maven.org/artifact/it.unibz.inf.ontop/ontop-rdf4j>.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
guide/getting-started.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Key concepts <https://ontop-vkg.org/guide/concepts.html> Command Line
Interface <https://ontop-vkg.org/guide/cli.html> →
```

## File: Interact with an Ontop SPARQL Endpoint _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#interact-with-an-ontop-sparql-endpoint> Interact with an Ontop
  SPARQL Endpoint

An Ontop Endpoint is accessible by the standard SPARQL HTTP
protocol(opens new window) <https://www.w3.org/TR/sparql11-protocol/>


      # <#url-of-the-ontop-sparql-endpoint> URL of the Ontop SPARQL Endpoint

When the endpoint is created by the Ontop CLI or Docker, the URL looks
like |http://localhost:8080/sparql|.


      # <#sending-http-requests> Sending HTTP Requests

You can use POST or GET requests carrying the SPARQL query to evaluate
(as per SPARQL HTTP protocol).

For example, with POST:

|POST http://localhost:8080/sparql
Content-Type: application/sparql-query
Accept: application/json

PREFIX : <http://example.org/voc#>
SELECT DISTINCT ?teacher {
  ?teacher a :Teacher .
}
|


      # <#using-curl-from-the-command-line> Using cURL from the command line

The above request can be sent with the |cURL| command:

|curl --request POST \
     --url http://localhost:8080/sparql \
     --header 'accept: application/json' \
     --header 'content-type: application/sparql-query' \
     --data 'PREFIX : <http://example.org/voc#> SELECT DISTINCT ?teacher {?teacher a :Teacher .}'
|


      # <#using-a-sparql-client-library> Using a SPARQL client library

Alternatively, you may use one of the many SPARQL clients(opens new
window) <https://www.w3.org/wiki/SparqlImplementations> available for
many programming and data analysis environments, as we demonstrate next
using the |SPARQLWrapper| library within a Python Jupyter Notebook
<https://ontop-vkg.org/tutorial/interact/tutorial/interact/jupyter>.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/interact/cli.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
vkg.org/tutorial/endpoint/endpoint-docker.html> Use Jupyter Notebook
with an Ontop SPARQL endpoint <https://ontop-vkg.org/tutorial/interact/
jupyter.html> →
```

## File: Introduction _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Guide

      o Introduction <https://ontop-vkg.org/guide/>
          + Versions <https://ontop-vkg.org/guide/#versions>
          + Main features <https://ontop-vkg.org/guide/#main-features>
          + Organizations <https://ontop-vkg.org/guide/#organizations>
          + Licenses <https://ontop-vkg.org/guide/#licenses>
          + Social <https://ontop-vkg.org/guide/#social>
          + Citations <https://ontop-vkg.org/guide/#citations>
      o Key concepts <https://ontop-vkg.org/guide/concepts.html>
      o Getting started <https://ontop-vkg.org/guide/getting-started.html>
      o Command Line Interface <https://ontop-vkg.org/guide/cli.html>
      o Standards compliance <https://ontop-vkg.org/guide/compliance.html>

  *

    Advanced

      o Ontop Mapping Language <https://ontop-vkg.org/guide/advanced/
        mapping-language.html>
      o Predefined query endpoint (beta) <https://ontop-vkg.org/guide/
        advanced/predefined.html>
      o Query logging <https://ontop-vkg.org/guide/advanced/logging.html>
      o HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
      o Configuration keys <https://ontop-vkg.org/guide/advanced/
        configuration.html>
      o Lenses <https://ontop-vkg.org/guide/advanced/lenses.html>

  *

    Data sources

  *

    Troubleshooting

      o FAQ <https://ontop-vkg.org/guide/troubleshooting/faq.html>

  *

    Meta

      o Glossary <https://ontop-vkg.org/guide/glossary.html>
      o Release notes <https://ontop-vkg.org/guide/releases.html>


  # <#introduction> Introduction

Ontop is a Virtual Knowledge Graph system. It exposes the content of
arbitrary relational databases as knowledge graphs. These graphs are
virtual, which means that data remains in the data sources instead of
being moved to another database.

Ontop translates SPARQL queries(opens new window) <https://www.w3.org/
TR/sparql11-query/> expressed over the knowledge graphs into SQL queries
executed by the relational data sources. It relies on R2RML
mappings(opens new window) <https://www.w3.org/TR/r2rml/> and can take
advantage of lightweight ontologies.


    # <#versions> Versions

This documentation is for Ontop 3.0 and more recent versions.

Most recent version:

  * Stable: Ontop 5.4.0, released on September 29, 2025.

See release notes <https://ontop-vkg.org/guide/releases> for more details.


    # <#main-features> Main features

  * Uses RDF 1.1 <https://ontop-vkg.org/guide/compliance#rdf-1-1> as
    graph data model
  * Supports RDFS and OWL 2 QL ontologies
  * Supports R2RML <https://ontop-vkg.org/guide/compliance#r2rml> and
    Ontop mappings
  * Supports the majority of SPARQL 1.1 features <https://ontop-vkg.org/
    guide/compliance#sparql-1-1>, including the main SPARQL aggregation
    functions (since 4.0.0) and GeoSPARQL functions <https://ontop-
    vkg.org/guide/compliance#geosparql-1-0> (since 4.1.0)
  * Can be deployed as a SPARQL endpoint <https://ontop-vkg.org/guide/
    cli#ontop-endpoint> and as a predefined query endpoint <https://
    ontop-vkg.org/guide/advanced/predefined> (since 4.1.0)
  * Produces efficient SQL queries by applying many optimizations
  * Supports the main database systems: PostgreSQL <https://ontop-
    vkg.org/guide/databases/postgres>, MySQL <https://ontop-vkg.org/
    guide/databases/mysql>, MariaDB <https://ontop-vkg.org/guide/
    databases/mariadb> (since 5.0.0), SQL Server <https://ontop-vkg.org/
    guide/databases/mssql>, Oracle <https://ontop-vkg.org/guide/
    databases/oracle>, DB2 <https://ontop-vkg.org/guide/databases/db2>,
    Snowflake <https://ontop-vkg.org/guide/databases/snowflake> (since
    5.0.0), Databricks <https://ontop-vkg.org/guide/databases/
    databricks> (since 5.0.0), Google BigQuery <https://ontop-vkg.org/
    guide/databases/bigquery> (since 5.0.2), AWS Redshift <https://
    ontop-vkg.org/guide/databases/redshift> (since 5.0.2), DuckDB
    <https://ontop-vkg.org/guide/databases/duckdb> (since 5.0.2), AWS
    DynamoDB <https://ontop-vkg.org/guide/databases/dynamodb> (since
    5.1.0), and TDengine <https://ontop-vkg.org/guide/databases/
    tdengine> (since 5.4.0)
  * Supports database federators such as Denodo <https://ontop-vkg.org/
    guide/databases/denodo>, Dremio <https://ontop-vkg.org/guide/
    databases/dremio> (since 4.1.0), Teiid (since 4.1.1), Apache Spark
    <https://ontop-vkg.org/guide/databases/spark> (since 4.2.0) and
    Trino <https://ontop-vkg.org/guide/databases/trino> / PrestoDB
    <https://ontop-vkg.org/guide/databases/presto> / AWS Athena
    <https://ontop-vkg.org/guide/databases/athena> (since 5.0.2)
  * Supports lenses <https://ontop-vkg.org/guide/advanced/lenses> which
    are "virtual views" specified outside of the data sources (since 4.2.0)
  * Can materialize <https://ontop-vkg.org/guide/cli#ontop-materialize>
    virtual graphs into RDF files
  * Provides a plugin for editing and testing mappings in the Protégé
    ontology editor(opens new window) <https://protege.stanford.edu/>


    # <#organizations> Organizations

Ontop is backed by the Free University of Bozen-Bolzano(opens new
window) <https://www.inf.unibz.it/krdb/in2data/> and Ontopic s.r.l.
(opens new window) <https://ontopic.ai/>. It also receives regular
important contributions from University of Bergen(opens new window)
<https://www.uib.no/> and Birkbeck, University of London(opens new
window) <http://www.bbk.ac.uk/>. See the community section <https://
ontop-vkg.org/community> for more details.


    # <#licenses> Licenses

Ontop is available under the Apache 2.0(opens new window) <https://
www.apache.org/licenses/LICENSE-2.0> license.

All the documentation is licensed under the Creative Commons
(Attribution)(opens new window) <http://creativecommons.org/licenses/
by/4.0/> license.


    # <#social> Social

You can find us on the following social platforms:

  * Twitter (ontop4obda)(opens new window) <https://twitter.com/ontop4obda>
  * Mastodon (@ontop@fosstodon.org) <https://fosstodon.org/@ontop>
  * Facebook (obdaontop)(opens new window) <https://www.facebook.com/
    obdaontop/>
  * Google Group (ontop4obda)(opens new window) <https://
    groups.google.com/forum/#!forum/ontop4obda>
  * GitHub (ontop/ontop)(opens new window) <https://github.com/ontop/ontop/>


    # <#citations> Citations

  *

    If you use Ontop in your work, please cite one of the following
    articles describing the system.

      o Guohui Xiao, Davide Lanti, Roman Kontchakov, Sarah Komla-Ebri,
        Elem Güzel-Kalayci, Linfang Ding, Julien Corman, Benjamin
        Cogrel, Diego Calvanese, and Elena Botoeva. The Virtual
        Knowledge Graph System Ontop(opens new window) <https://
        research.bcgl.fr/pdfs/ontop-iswc20.pdf>. In: International
        Semantic Web Conference (Resource Track), 2020.
      o Diego Calvanese, Benjamin Cogrel, Sarah Komla-Ebri, Roman
        Kontchakov, Davide Lanti, Martin Rezk, Mariano Rodriguez-Muro,
        and Guohui Xiao. Ontop: Answering SPARQL Queries over Relational
        Databases(opens new window) <http://www.semantic-web-
        journal.net/content/ontop-answering-sparql-queries-over-
        relational-databases-1>. In: Semantic Web Journal 8.3 (2017),
        pp. 471–487.
  *

    If you want to cite the techniques behind Ontop, check our
    publications <https://ontop-vkg.org/research/publications>.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
guide/README.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

Key concepts <https://ontop-vkg.org/guide/concepts.html> →
```

## File: Join Lens _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#join-lens> Join Lens

Join lenses can be used to combine multiple relations into one.
Additionally, a filter expression can be provided as a join condition.

For this example, we will look at the tables |museums| and |workers|
from the DuckDB database. For each individual of the |:Worker| class, we
want to set its property |:workAddress| to the address of the museum
they work at. The tables have the following schemas:

/museums/

column 	type
museum_id 	integer
name 	string
address 	string
yearly_income 	integer
yearly_spendings 	integer
ratings 	array of floats

/workers/

column 	type
worker_id 	integer
full_name 	string
role 	string
museum_id 	integer
titles 	array of strings
access_level 	integer

Notably, the table |workers| has the column |museum_id| which references
the primary key of the table |museums|. In SQL, we can run a |JOIN|
query over these two tables to combine all rows of |worker| with their
corresponding museums. In Ontop, we can instead create a join lens, that
can be referenced by the mapping.

The join lens has the following structure:

|{
    "name": [String],
    "join": {
        "relations": [[String]],
        "columnPrefixes": [String]
    },
    "columns": {
        "added": [{
            "name": String,
            "expression": String
        }],
        "hidden": [String]
    },
    "filterExpression": String,
    "type": "JoinLens"
}
|

The |join| field takes an object consisting of a list of relation
references and a list of /column prefixes/. For each relation, its
corresponding column prefix will be prepended to the names of all of its
columns.

The fields |columns| and |filterExpression| work exactly the way they
worked for basic lenses <https://ontop-vkg.org/tutorial/lenses/basic-
lens.html>, with the only reference being that now, column names have to
be combined with the individual relation's prefix when referencing them
in expressions.

In this example, the relations we use are |museums| and |workers|, and
we choose the prefixes |m_| and |w_| for them respectively. Since we
want to perform a |JOIN| operation, rather than a cross-product, we also
have to supply the filter expression |m_museum_id = w_museum_id|. After
including these values, the |lenses.json| file should look like this:

|{
    "relations": [
        {
            "name": ["lenses", "museums_workers"],
            "join": {
                "relations": [
                    ["museums"],
                    ["workers"]
                ],
                "columnPrefixes": [
                    "m_",
                    "w_"
                ]
            },
            "columns": ...,
            "filterExpression": "m_museum_id = w_museum_id",
            "type": "JoinLens"
        }
    ]
}
|

The only remaining field is |columns|. As mentioned earlier, this field
is handled analogously to the basic lens |columns| field, allowing the
user to add and remove specific columns. For this example, we want to
set the property |:workAddress| for each |:Worker| individual. Because
of that, we only require the column |worker_id| from |workers| and |
address| from |museums| - all other columns can be hidden, and no column
has to be added:

|{
    "relations": [
        {
            "name": ["lenses", "museum_workers"],
            "join": {
                "relations": [
                    ["museums"],
                    ["workers"]
                ],
                "columnPrefixes": [
                    "m_",
                    "w_"
                ]
            },
            "columns": {
                "added": [],
                "hidden": [
                    "m_museum_id",
                    "m_name",
                    "m_yearly_income",
                    "m_yearly_spendings",
                    "m_ratings",
                    "w_full_name",
                    "w_role",
                    "w_museum_id",
                    "w_titles",
                    "w_access_level"                   
                ]
            },
            "filterExpression": "m_museum_id = w_museum_id",
            "type": "JoinLens"
        }
    ]
}
|


      # <#mapping> Mapping

Now that the lens file is created, we can construct our mapping. For
this, we once again start from the mapping template file provided with
the tutorial files.

We can add a mapping entry to it, referencing the newly created lens.

|mappingId	MAPID-museum-worker-address
target		data:worker/{w_worker_id} :workAddress {m_address} .
source		SELECT w_worker_id, m_address FROM lenses.museum_workers;
|

Now, we can test the lens and mapping, by copying the corresponding
files to the Ontop endpoint directory and running the following query:

|PREFIX : <http://example.org/museum_kg/>
SELECT ?name ?address WHERE {
    ?worker a :Worker .
    ?worker :name ?name .
    ?worker :workAddress ?address .
}
|

If everything was prepared correctly, this should result in a list of
employee names, together with the address of the museum they work at.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/lenses/join-lens.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html> →
```

## File: Key concepts _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Guide

      o Introduction <https://ontop-vkg.org/guide/>
      o Key concepts <https://ontop-vkg.org/guide/concepts.html>
          + Virtual Knowledge Graph (VKG) <https://ontop-vkg.org/guide/
            concepts.html#virtual-knowledge-graph-vkg>
          + RDF <https://ontop-vkg.org/guide/concepts.html#rdf>
          + SPARQL query <https://ontop-vkg.org/guide/
            concepts.html#sparql-query>
          + Mappings <https://ontop-vkg.org/guide/concepts.html#mappings>
          + Ontology <https://ontop-vkg.org/guide/concepts.html#ontology>
          + VKG specification <https://ontop-vkg.org/guide/
            concepts.html#vkg-specification>
          + SPARQL endpoint <https://ontop-vkg.org/guide/
            concepts.html#sparql-endpoint>
      o Getting started <https://ontop-vkg.org/guide/getting-started.html>
      o Command Line Interface <https://ontop-vkg.org/guide/cli.html>
      o Standards compliance <https://ontop-vkg.org/guide/compliance.html>

  *

    Advanced

      o Ontop Mapping Language <https://ontop-vkg.org/guide/advanced/
        mapping-language.html>
      o Predefined query endpoint (beta) <https://ontop-vkg.org/guide/
        advanced/predefined.html>
      o Query logging <https://ontop-vkg.org/guide/advanced/logging.html>
      o HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
      o Configuration keys <https://ontop-vkg.org/guide/advanced/
        configuration.html>
      o Lenses <https://ontop-vkg.org/guide/advanced/lenses.html>

  *

    Data sources

  *

    Troubleshooting

      o FAQ <https://ontop-vkg.org/guide/troubleshooting/faq.html>

  *

    Meta

      o Glossary <https://ontop-vkg.org/guide/glossary.html>
      o Release notes <https://ontop-vkg.org/guide/releases.html>


  # <#key-concepts> Key concepts


    # <#virtual-knowledge-graph-vkg> Virtual Knowledge Graph (VKG)

A Knowledge Graph (KG) is, in our terminology, a graph using the RDF
data model.

A Virtual KG (VKG) is a virtual representation in RDF of non-RDF data,
which is generally relational data. With a VKG, the data remains in the
data sources in its original format but can be virtually represented as
an RDF graph.


    # <#rdf> RDF

The Resource Description Framework (RDF)(opens new window) <https://
www.w3.org/TR/rdf11-concepts/> is one of the two main data models for
graphs (together with property graphs(opens new window) <http://
graphdatamodeling.com/Graph%20Data%20Modeling/GraphDataModeling/page/
PropertyGraphs.html>). RDF mainly targets *data integration*
applications while property graphs are used for building graph databases.

In RDF, data is modelled using classes and properties.

Starting from 3.0, Ontop supports RDF 1.1(opens new window) <https://
www.w3.org/TR/rdf11-concepts/>.


    # <#sparql-query> SPARQL query

SPARQL(opens new window) <https://www.w3.org/TR/sparql11-query/> is the
standard query language for RDF graphs.

Ontop is capable of answering SPARQL queries expressed over the VKG.
Ontop translates these SPARQL queries into SQL queries, which are then
executed over the relational data sources.

Ontop supports a large fragment of SPARQL 1.1(opens new window)
<https://www.w3.org/TR/sparql11-query/>.


    # <#mappings> Mappings

Mappings specify the correspondence between the data models of the
relational data sources and the RDF graph. Ontop supports the R2RML
standard mapping language(opens new window) <https://www.w3.org/TR/
r2rml/> and the Ontop mapping language <https://ontop-vkg.org/guide/
advanced/mapping-language>, which is fully interoperable with R2RML.


    # <#ontology> Ontology

An ontology specifies the formal relations between the classes and
properties used by the RDF graph. It is mainly used for enriching the
RDF graph by, for instance, taking account of class hierarchies.

Ontop supports lightweight ontologies expressed in RDFS(opens new
window) <https://www.w3.org/TR/rdf-schema/> or in the slightly more
expressive OWL 2 QL(opens new window) <https://www.w3.org/TR/owl2-
profiles/#OWL_2_QL> fragment of OWL.


    # <#vkg-specification> VKG specification

VKG specifications are composed of mappings and optionally of ontologies.


    # <#sparql-endpoint> SPARQL endpoint

A SPARQL endpoint(opens new window) <https://www.w3.org/TR/2013/REC-
sparql11-protocol-20130321/> is a standardized HTTP-based Web API. It
makes the RDF graph queryable by any HTTP client.

Ontop enables VKG specifications to be deployed as SPARQL endpoints.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
guide/concepts.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Introduction <https://ontop-vkg.org/guide/> Getting started <https://
ontop-vkg.org/guide/getting-started.html> →
```

## File: Lenses _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Guide

      o Introduction <https://ontop-vkg.org/guide/>
      o Key concepts <https://ontop-vkg.org/guide/concepts.html>
      o Getting started <https://ontop-vkg.org/guide/getting-started.html>
      o Command Line Interface <https://ontop-vkg.org/guide/cli.html>
      o Standards compliance <https://ontop-vkg.org/guide/compliance.html>

  *

    Advanced

      o Ontop Mapping Language <https://ontop-vkg.org/guide/advanced/
        mapping-language.html>
      o Predefined query endpoint (beta) <https://ontop-vkg.org/guide/
        advanced/predefined.html>
      o Query logging <https://ontop-vkg.org/guide/advanced/logging.html>
      o HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
      o Configuration keys <https://ontop-vkg.org/guide/advanced/
        configuration.html>
      o Lenses <https://ontop-vkg.org/guide/advanced/lenses.html>
          + Example <https://ontop-vkg.org/guide/advanced/
            lenses.html#example>
          + Document root <https://ontop-vkg.org/guide/advanced/
            lenses.html#document-root>
          + Lens <https://ontop-vkg.org/guide/advanced/lenses.html#lens>
          + Constraints <https://ontop-vkg.org/guide/advanced/
            lenses.html#constraints>

  *

    Data sources

  *

    Troubleshooting

      o FAQ <https://ontop-vkg.org/guide/troubleshooting/faq.html>

  *

    Meta

      o Glossary <https://ontop-vkg.org/guide/glossary.html>
      o Release notes <https://ontop-vkg.org/guide/releases.html>


  # <#lenses> Lenses

/Since 4.2.0 (was experimental in 4.1.x)/

/Prior to 5.0.0, lenses were named Ontop views/.

Lenses are relational views defined at the level of Ontop and unknown to
the underlying database. Lenses can be defined from database relations
and from other lenses.

As database relations, lenses have a name which can be used in the
source part of the mapping entries. They are specified in a separate
file that can be provided to Ontop through a dedicated parameter (|--
lenses| for the CLI commands <https://ontop-vkg.org/guide/cli> that
support it, |ONTOP_LENSES_FILE| for the Docker image(opens new window)
<https://hub.docker.com/r/ontop/ontop>).

At the moment, 5 types of lenses are available:

 1. Basic lenses <#basiclens> (defined over one base relation)
 2. Join lenses <#joinlens> (defined over multiple base relations)
 3. SQL lenses <#sqllens> (defined from an arbitrary SQL query)
 4. Union lenses <#unionlens> (defined as a union of multiple base
    relations)
 5. Flatten lenses <#flattenlens> (defined as an unnest operation over
    one base relation)

Don't use lenses in complex source SQL queries

The Ontop mapping SQL parser only parses simple forms of SQL queries
(without unions, aggregations, limits, order by, etc.). Non-parsed
queries are treated as black-box views, that is as strings that are
injected into the final SQL queries sent to the database. If some lenses
appear in these black-box views, the resulting SQL queries will be
rejected by the database because they refer to relations it does not know.

One interesting feature of lenses is that you can specify additional
constraints <#constraints> holding on them (in addition to the ones that
can be inferred from base relations). The constraints can be:

  * Unique constraints <#uniqueconstraint>
  * Other functional dependencies <#otherfunctionaldependency>
  * Foreign keys <#foreignkey>
  * Non-null constraints <#nonnullconstraint> (columns that do no
    include null values)
  * IRI-safe constraints <#irisafeconstraint> (columns on which the
    R2RML safe encoding has no effect). /Since 5.0.2/.

Tutorial

To see lenses used in practice, check the tutorial <https://ontop-
vkg.org/tutorial/lenses/>


    # <#example> Example

|{
    "relations": [
        {
            "name": ["\"lenses\"","\"hr\"","\"persons\""],
            "baseRelation": ["\"hr\"","\"persons\""],
            "filterExpression": "\"firstName\" IS NOT NULL AND \"lastName\" IS NOT NULL", 
            "columns": {
                "added": [
                    {
                        "name": "\"fullName\"",
                        "expression": "CONCAT(UPPER(\"firstName\"),' ',\"lastName\")"
                    }
                ],
                "hidden": [
                    "\"firstName\"",
                    "\"lastName\""
                ]
            },
            "uniqueConstraints": {
                "added": [
                    {
                        "name": "uc2",
                        "determinants": ["\"ssn\""]
                    }
                ]
            },
            "otherFunctionalDependencies": {
                "added": [
                    {
                        "determinants": ["\"regionOfResidence\""],
                        "dependents": ["\"countryOfResidence\""]
                    }
                ] 
            },
            "foreignKeys": {
                "added": [
                    {
                        "name": "fk1",
                        "from": ["\"regionOfResidence\""],
                        "to": {
                            "relation": ["\"geo\"","\"regions\""],
                            "columns": ["\"reg_id\""]
                        }
                    }
                ]
            },
            "nonNullConstraints": {
                "added": [
                    "\"email\""
                ]
            },
            "iriSafeConstraints": {
                "added": [
                    "\"ssn\""
                ]
            },
            "type": "BasicLens"
        },
        {
        "name": [
            "\"lenses\"",
            "\"rooms\""
        ],
        "join": {
            "relations": [
            ["\"rooms\""],
            ["\"lenses\", \"hotels\""]
            ],
            "columnPrefixes": [
            "r_",
            "h_"
            ]
        },
        "filterExpression": "\"r_hotel_id\"=\"h_id\" AND (\"h_stars\" = '***' OR \"h_price\" = '€€€') AND \"r_guests\" = 2",
        "columns": {
            "added": [
            ],
            "hidden": [
            ]
        },
        "type": "JoinLens"
        },
        {
            "name": ["\"lenses\"","\"geo\"","\"top_region\""],
            "query": "SELECT \"regionOfResidence\" AS \"region\", COUNT(*) FROM \"hr\".\"persons\" GROUP BY \"regionOfResidence\" ORDER BY COUNT(*) DESC LIMIT 1",
            "type": "SQLLens"
        }
    ]
}

|


    # <#document-root> Document root

The lenses document has the following JSON structure:

|{ 
    "relations": [Lens]
}
|

Key 	Type
|relations| 	Array of |Lens|-s


    # <#lens> |Lens|


      # <#common-fields> Common fields

All the lenses accept the following fields (most of them are optional):

|{
    "name": [String],
    "uniqueConstraints": {
        "added": [UniqueConstraint]
    },
    "otherFunctionalDependencies": {
        "added": [OtherFunctionalDependency]
    },
    "foreignKeys": {
        "added": [ForeignKey]
    },
    "nonNullConstraints": {
        "added": [String]
    },
    "iriSafeConstraints": {
        "added": [String]
    },
    "type": String
}
|

Key 	Type 	Description
|name| 	Array of Strings 	View name components (with correct quoting)
|uniqueConstraints| 	JSON Object 	Optional
|uniqueConstraints.added| 	Array of |UniqueConstraint|-s 	
|otherFunctionalDependencies| 	JSON Object 	Optional
|otherFunctionalDependencies.| |added| 	Array of |
OtherFunctionalDependency|-s 	
|foreignKeys| 	JSON Object 	Optional
|foreignKeys.added| 	Array of |ForeignKey|-s 	
|nonNullConstraints| 	JSON Object 	Optional
|nonNullConstraints.added| 	Array of Strings 	Names of non-null columns
(with correct quoting). One string per column
|iriSafeConstraints| 	JSON Object 	Optional
|iriSafeConstraints.added| 	Array of Strings 	Names of IRI-safe columns
(with correct quoting). One string per column
|type| 	String 	Either |BasicLens|, |JoinLens| or |SQLLens|


      # <#basiclens> |BasicLens|

A basic lens is defined from one base (parent) relation, over which it
can apply a filter, an extended projection and additional constraints.

In addition to the common fields <#common-fields>, basic lenses accept
the following ones:

|{
    "baseRelation": [String],
    "columns": {
        "added": [AddedColumn],
        "hidden": [String]
    },
    "filterExpression": String,
    "type": "BasicLens"
}
|

Key 	Type 	Description
|baseRelation| 	Array of Strings 	Name components of the base relation
(with correct quoting)
|columns| 	JSON Object 	Optional (since 5.0.2)
|columns.added| 	Array of |AddedColumn|-s 	
|columns.hidden| 	Array of Strings 	Names of the columns from the base
relation to be projected away (with correct quoting)
|filterExpression| 	String 	Expression expressed in the SQL dialect of
the data source. Can only refer to columns from the base relation, not
to added columns. Can be empty. Optional


        # <#addedcolumn> |AddedColumn|

Added columns have the following definition:

|{
    "name": String,
    "expression": String
}
|

Key 	Type 	Description
|name| 	String 	New column name (with correct quoting)
|expression| 	String 	SQL expression defining the column. Can only refer
to columns from the base relations, not to added columns


      # <#joinlens> |JoinLens|

A join lens is defined from multiple base relations, over which it can
apply a filter (joining condition), an extended projection and
additional constraints.

A prefix is assigned to each base relation and is added as a prefix to
their column names. This allows to avoid conflicts due to columns with
the same names in base relations.

In addition to the common fields <#common-fields>, join lenses accept
the following ones:

|{
    "join": {
        "relations": [[String]],
        "columnPrefixes": [String]
    },
    "columns": {
        "added": [AddedColumn],
        "hidden": [String]
    },
    "filterExpression": String,
    "type": "JoinLens"
}
|

Key 	Type 	Description
|join| 	JSON Object 	
|join.relations| 	Array of arrays of Strings 	Arrays of the name
components of each base relation (with correct quoting)
|join.columnPrefixes| 	Array of Strings 	Prefix for each base relation
to be applied on its column names. Follows the same order as |
join.relations|.
|columns| 	JSON Object 	Optional (since 5.0.2)
|columns.added| 	Array of |AddedColumn|-s 	
|columns.hidden| 	Array of Strings 	Names of the columns from the base
relations to be projected away (with correct quoting)
|filterExpression| 	String 	Expression expressed in the SQL dialect of
the data source. Can only refer to prefixed columns from the base
relations, not to added columns. Can be empty. Optional


      # <#sqllens> |SQLLens|

A SQL lens is defined from an arbitrary SQL query. While expressive, it
also comes with important restrictions. When applicable, other types of
lenses should be used instead.

Avoid referring to lenses in the SQL query

As Ontop uses the same parser as from the mapping source queries, the
same restriction apply: non-parsed queries will be treated internally as
black-box views and will fail. Please consider using other types of
lenses if possible.

No unique constraint and foreign key inferred from the base relations

Please consider using other types of lenses if possible.

In addition to the common fields <#common-fields>, SQL lenses accept the
following ones:

|{
    "query": String,
    "type": "SQLLens"
}
|

Key 	Type 	Description
|query| 	String 	SQL query


      # <#unionlens> |UnionLens|

/Since 5.1.0/

A union lens is defined from multiple base relations that share
attributes with exactly the same names and types. The relations will be
merged with each other, concatenating their contents.

When defining a union lens, a "/provenance column/" can be determined to
hold, for each data entry, the name of the base relation it originates from.

In addition to the common fields <#common-fields>, union lenses accept
the following ones:

|{
    "unionRelations": [[String]],
    "makeDistinct": boolean,
    "provenanceColumn": String,
    "type": "UnionLens"
}
|

Key 	Type 	Description
|unionRelations| 	Array of arrays of Strings 	Arrays of the name
components of each base relation (with correct quoting).
|makeDistinct| 	boolean 	Determines, if the final resulting union should
be made distinct.
|unionRelations| 	String 	The name of the column that should contain the
base relation each entry originates from. If not provided, provenance
information will not be included in the result.


      # <#flattenlens> |FlattenLens|

/Since 5.1.0/

A flatten lens is defined from one base (parent) relation that contains
an array-like data structure in one of its fields. The array is
flattened into multiple rows, where each row contains a single item from
the flattened array in the |new| column. Columns of the base relation
not included in the |kept| list will be discarded when flattening the array.

In addition, a |position| column can be included in the lens, providing
a unique index for each flattened row in its parent relation.

NOTE

The flatten operation is only performed on the "outer-most" array layer.
Multi-dimensional arrays will have their dimensionality reduced by 1.

In addition to the common fields <#common-fields>, flatten lenses accept
the following ones:

|{
    "flattenedColumn": {
        "name": String,
        "datatype": String
    },
    "columns": {
        "kept": [String],
        "new": String,
        "position": String
    },
    "type": "FlattenLens"
}
|

Key 	Type 	Description
|flattenedColumn| 	JSON Object 	Identifies the column that is to be
flattened.
|flattenedColumn.name| 	String 	The name of the column that is to be
flattened.
|flattenedColumn.datatype| 	String 	The type of the column that is to be
flattened.
|columns| 	JSON Object 	Defines the columns of the output relation.
|columns.kept| 	Array of Strings 	The names of the columns from the base
relation that should be included in the output.
|columns.new| 	String 	The name of the newly created column that should
hold the elements of the flattened array.
|columns.position| 	String 	The name of the newly created column that
should hold the index of each flattened element in its source list. If
not provided, no position column will be included.

Due to various limitations in the language definitions, the FlattenLens
is currently not equally supported for all dialects. The table below
lists, in detail, the level of support for each dialect. /"Flatten"/
defines if the flatten lens is supported by the dialect, /"position"/
defines if the |position| column can be provided, and /"Infer base
type"/ indicates if Ontop is able to infer the type of the flattened
output column if the input is an array type. /"Array Type"/ and /"JSON
Type"/ indicate if the flatten lens is supported over array-like types
(|ARRAY|, |ARRAY<T>|, |LIST|, |T[]| etc.) and JSON-arrays (either as |
JSON| type or as |VARCHAR|) respectively.

Dialect 	Flatten 	Position 	Infer base type 	Array Type 	JSON Type
AWS Athena 	YES 	YES 	YES 	YES 	NO
AWS DynamoDB 	NO 	NO 	NO 	NO 	NO
AWS Redshift 	YES 	YES 	NO 	YES 	NO
BigQuery 	YES 	YES 	YES 	YES 	NO
DB2 	NO 	NO 	NO 	YES 	NO
Databricks 	YES 	YES 	YES 	YES 	YES
Denodo 	NO 	NO 	NO 	YES 	NO
Dremio 	YES 	NO 	NO 	YES 	NO
DuckDB 	YES 	YES 	YES 	YES 	NO
MariaDB 	YES 	YES 	NO 	NO 	YES
MS SQLServer 	YES 	NO 	NO 	NO 	YES
MySQL 	YES 	YES 	NO 	NO 	YES
Oracle 	YES 	YES 	NO 	NO 	YES
PostgreSQL 	YES 	YES 	YES 	YES 	YES
Presto 	YES 	YES 	YES 	YES 	NO
Snowflake 	YES 	YES 	NO 	YES 	NO
SparkSQL 	YES 	YES 	YES 	YES 	YES
TDengine 	NO 	NO 	NO 	NO 	NO
Trino 	YES 	YES 	YES 	YES 	NO


    # <#constraints> Constraints


      # <#uniqueconstraint> |UniqueConstraint|

|{
    "name": String,
    "determinants": [String]
}
|

Key 	Type 	Description
|name| 	String 	Name of the unique constraint
|determinants| 	Array of Strings 	Column names (with correct quoting)


      # <#otherfunctionaldependency> |OtherFunctionalDependency|

Useful for dealing with denormalized data, where unique constraints
cannot be applied.

|{
    "determinants": [String],
    "dependents": [String]
}
|

Key 	Type 	Description
|determinants| 	Array of Strings 	Column names (with correct quoting)
that determine the values of dependent columns
|dependents| 	Array of Strings 	Column names (with correct quoting)
whose values are determined by determinant columns


      # <#foreignkey> |ForeignKey|

|{
    "name": String,
    "from": [String],
    "to": {
        "relation": [String],
        "columns": [String]
    }
}
|

Key 	Type 	Description
|name| 	String 	Name of the foreign key
|from| 	Array of Strings 	Source columns (with correct quoting)
|to| 	JSON Object 	
|to.relation| 	Array of Strings 	Name components of the target relation
(with correct quoting)
|to.columns| 	Array of Strings 	Target columns (with correct quoting).
Same order as for the source columns


      # <#nonnullconstraint> |NonNullConstraint|

|{
    "added": [String]
}
|

Key 	Type 	Description
|added| 	Array of Strings 	List of names of non-nullable columns. One
String per column


      # <#irisafeconstraint> |IRISafeConstraint|

|{
    "added": [String]
}
|

Key 	Type 	Description
|added| 	Array of Strings 	List of names of IRI-safe columns. One String
per column

Edit this page <https://github.com/ontop/ontop-website/edit/master/
guide/advanced/lenses.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Configuration keys <https://ontop-vkg.org/guide/advanced/
configuration.html> Generic JDBC (not recommended) <https://ontop-
vkg.org/guide/databases/generic.html> →
```

## File: Ontop Mapping Language _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Guide

      o Introduction <https://ontop-vkg.org/guide/>
      o Key concepts <https://ontop-vkg.org/guide/concepts.html>
      o Getting started <https://ontop-vkg.org/guide/getting-started.html>
      o Command Line Interface <https://ontop-vkg.org/guide/cli.html>
      o Standards compliance <https://ontop-vkg.org/guide/compliance.html>

  *

    Advanced

      o Ontop Mapping Language <https://ontop-vkg.org/guide/advanced/
        mapping-language.html>
          + Source Query <https://ontop-vkg.org/guide/advanced/mapping-
            language.html#source-query>
          + Target Triple Structure <https://ontop-vkg.org/guide/
            advanced/mapping-language.html#target-triple-structure>
          + Meta-Mapping <https://ontop-vkg.org/guide/advanced/mapping-
            language.html#meta-mapping>
      o Predefined query endpoint (beta) <https://ontop-vkg.org/guide/
        advanced/predefined.html>
      o Query logging <https://ontop-vkg.org/guide/advanced/logging.html>
      o HTTP caching <https://ontop-vkg.org/guide/advanced/caching.html>
      o Configuration keys <https://ontop-vkg.org/guide/advanced/
        configuration.html>
      o Lenses <https://ontop-vkg.org/guide/advanced/lenses.html>

  *

    Data sources

  *

    Troubleshooting

      o FAQ <https://ontop-vkg.org/guide/troubleshooting/faq.html>

  *

    Meta

      o Glossary <https://ontop-vkg.org/guide/glossary.html>
      o Release notes <https://ontop-vkg.org/guide/releases.html>


  # <#ontop-mapping-language> Ontop Mapping Language

While Ontop is compatible with the W3C standard mapping language
R2RML(opens new window) <https://www.w3.org/TR/2012/REC-r2rml-20120927/
>, it also provides its own native mapping language (*OBDA*).

An OBDA mapping file is a text file with the extension |.obda| and
consists of two main sections:

  * |PrefixDeclaration|: a list of prefix definitions used in the
    mapping file. Each prefix is declared by a pair of its identifier
    (or name) and its IRI definition.
  * |MappingDeclaration|: collection of *mapping assertions* where each
    mapping assertion consists of three fields: |mappingId|, |source|
    and |target|. The mappingId is any string identifying the assertion,
    the source is an arbitrary SQL query over the database, and the
    target is a triple template <#target-triple-template> that contains
    placeholders that reference column names mentioned in the source query.

The following is an example of a valid OBDA mapping file:

|[PrefixDeclaration]
:		http://www.example.org/library#
xsd:	http://www.w3.org/2001/XMLSchema#
rdf:	http://www.w3.org/1999/02/22-rdf-syntax-ns#

[MappingDeclaration] @collection [[
mappingId     Book collection
target        :BID_{id} a :Book .
source        SELECT id FROM books

mappingId     Book title
target        :BID_{id} :title {title} .
source        SELECT id, title FROM books
]]
|

The empty lines between the two sections and between the mappings are
mandatory.

Comments

To comment out a line in an OBDA mapping file, you can use the |;|
character at the beginning of the line. Note that you can only comment
out entire lines, not parts of them.


    # <#source-query> Source Query

The |source| query in a mapping assertion is an SQL query over the
underlying relational database and as such it uses the SQL syntax of
that specific database dialect. So things like quotes conventions may
vary depending on the database system used. For example, in PostgreSQL
double quotes are used for tables and column identifiers, while in MySQL
backticks are used.

WARNING

The Ontop SQL parser only parses simple SQL queries without unions,
aggregations, order by, etc. Non-parsed queries are treated as black-box
views and sent directly to the database so the optimizations that Ontop
can apply are limited.


    # <#target-triple-structure> Target Triple Structure

This section explains the syntax and limitations for the |target| of
mapping assertions, which is an adaptation of the Turtle(opens new
window) <http://www.w3.or/TR/turtle> syntax. Each target triple is
written like an RDF subject-predicate-object (SPO) graph.

|target  <http://www.example.org/library#BID_{id}> rdf:type :Book .
                       [S]                          [P]     [O]

target  <http://www.example.org/library#BID_{id}> :title {title} .
                       [S]                          [P]     [O]
|

Each triple must be separated by a space followed by a period (|s p
o .|) and is composed of three nodes:

  *

    *Subject node*: The subject node can be one of the following terms:

     1. IRI or blank node constant: e.g. |<http://www.example.org/
        library#BID_FF125>| or |_:Library1|
     2. IRI or blank node template <#iri-or-blank-node-template>: e.g. |
        <http://www.example.org/library#BID_{id}>| or |_:{id}|
     3. IRI or blank node column: a column directly from the source
        query (e.g. |<{iri}>|)
  *

    *Predicate node*: The predicate node can be one of the following terms:

     1. IRI constant: e.g. |<http://www.example.org/library#title>|
     2. IRI template: e.g. |<http://www.example.org/library#{predicate}>|
     3. IRI column: a column from the source query (e.g. |
        <{predicate_iri}>|)

    Note that the special predicate |a| is a shortcut that stands for |
    rdf:type| (more precisely, for |<http://www.w3.org/1999/02/22-rdf-
    syntax-ns#type>|).

  *

    *Object node*: The object node can be one of the following terms:

     1. IRI or blank node constant: e.g., |<http://www.example.org/
        library#Book>|
     2. IRI or blank node template <#iri-template>: e.g., |<http://
        www.example.org/Author-{pid}>|
     3. IRI or blank node column: e.g. |<{object_iri}>|
     4. Literal constant: either an implicitly typed literal (e.g., |
        123| or |true| or |"John"|), an explicitly typed literal (e.g.,
        |"John"^^xsd:string|, |"123"^^xsd:integer|) or a literal with a
        language tag (e.g., |"Il Trono di Spade"@it|).
     5. Literal column: a column from the source query (e.g., |
        {title}|). It can also be explicitly typed (e.g., |{title}
        ^^xsd:string|) or have a language tag (e.g., |{title}@en|).
     6. Literal template: just like literal constants, literal templates
        can also be explicitly typed or have a language tag. Literal
        templates can be useful to create complex, arbitrary literals by
        concatenation (e.g. |"POINT ({longitude}
        {latitude})"^^geo:wktLiteral|).

IRI and blank node templates apply *IRI-safe* encoding to their columns,
following the R2RML standard(opens new window) <https://www.w3.org/TR/
r2rml/#dfn-iri-safe>. For example, if we have the IRI template |<http://
www.example.org/library#BID_{name}>| and suppose that for the |name|
column we have the value |"John Library"|, then the generated IRI will
be |<http://www.example.org/library#BID_John%20Library>|. Instead, IRI
columns are not transformed, so their values are expected to already be
valid IRIs.

WARNING

Literal constants, templates, and columns can either be explicitly typed
or have a language tag, but the two cannot be combined. For example, the
following mapping is /invalid/:

|mappingId     Book titles in Italian
source        SELECT id, title FROM books WHERE lang='ITALIAN'
target        :BID_{id} :title {title}^^xsd:string@it .
|


      # <#iri-or-blank-node-template> IRI or Blank Node Template

IRI or blank node templates are used in the target of mapping assertions
for the identification of generated objects. An IRI/blank node template
is a string with placeholders (e.g. |<http://www.example.org/
library#BID_{id}>|). More than one placeholder can appear in a template,
which allows constructing complex paths. For example, as an IRI template:

|mappingId     Spare parts
source        SELECT product, part, vendor FROM product
target        <http://example.org/{vendor}/{product}/{part}> a :Part .
|

or as a blank node template:

|mappingId     Spare parts
source        SELECT product, part, vendor FROM product
target        _:{product}/{part} a :Part .
|


        # <#prefixes-in-iri-or-blank-node-templates> Prefixes in IRI or
        Blank Node Templates

Prefixes can be used when writing IRI or blank node templates and are
replaced by their definition when Ontop parses the mappings.

/Example/. Assume that the following prefixes are defined:

|:	http://www.example.org/ontology1#
p:	http://www.example.org/ontology2#
|

Then this mapping assertion:

|mappingId     Example
source        SELECT col1, col2 FROM table
target        <http://www.example.org/ontology1#{col1}> :property <http://www.example.org/ontology2#{col2}>
|

is equivalent to this mapping assertion:

|mappingId     Example
source        SELECT col1, col2 FROM table
target        :{col1} :title p:{col2}
|


      # <#literal> Literal


        # <#literal-typing> Literal Typing

It is possible to explicitly declare the type of a literal by suffixing
it with |^^| followed by the IRI of the datatype. For example:

|mappingId     Book titles
source        SELECT id, title, edition, comment FROM books
target        :BID_{id} :title {title}^^xsd:string; :edition {edition}^^xsd:integer; :description {comment} .
|

The type used in the mapping has to agree with the type in the ontology
(if specified). If the type is not specified (for example, for the |
description| property in the previous mapping), the system will look at
the SQL type of the SQL column used in the mapping and will use the
*Natural Mapping of SQL values*(opens new window) <https://www.w3.org/
TR/r2rml/#natural-mapping> as defined by R2RML standard(opens new
window) <https://www.w3.org/TR/r2rml/>.


        # <#language-tags> Language Tags

The language for a literal can be specified directly using the |@|
symbol followed by the language tag. For example:

|mappingId     Book titles in Italian
source        SELECT id, title FROM books WHERE lang='ITALIAN'
target        :BID_{id} :title {title}@it .
|

WARNING

Language tags can only be constants, it is not possible to obtain them
dynamically from the database. So for example, the following mapping
is /invalid/:

|mappingId     Book titles in Italian
source        SELECT id, title, lang FROM books
target        :BID_{id} :title {title}@{lang} .
|


      # <#named-graphs> Named Graphs

By default, triples generated by a triple pattern are added to the
default graph. However, it is also possible to specify a named graph by
using the keyword |GRAPH| followed by an IRI constant or template and
then the triple pattern in curly braces. For example:

|mappingId     Book titles in Italian
source        SELECT id, title FROM books WHERE lang='ITALIAN'
target        GRAPH <http://www.example.org/graphs/italian> { :BID_{id} :title {title}@it . }
|

or, using a template for the graph name:

|mappingId     Book titles in Italian
source        SELECT id, title FROM books WHERE lang='ITALIAN'
target        GRAPH <http://www.example.org/graphs/{lang}> { :BID_{id} :title {title}@it . }
|


      # <#compact-form> Compact Form

Following the Turtle(opens new window) <https://www.w3.org/TR/turtle/>
syntax, Ontop's native mapping format allows writing an RDF graph in a
compact textual form. A set of triples sharing the same subject can be
written as a *predicate list*, where predicate-object pairs are
separated by semicolons. Similarly, a set of triples sharing the same
subject and predicate can be written as an *object list*, where objects
are separated by commas.

*Predicate List*: These two examples are equivalent ways of writing the
triple template for an Author.

|:Author-{ID} a :Author .
:Author-{ID} :firstName {FNAME} .
:Author-{ID} :lastName {LNAME} .
:Author-{ID} :writes :Book-{ID} .
|

|:Author-{ID} a :Author; :firstName {FNAME}; :lastName {LNAME}; :writes :Book-{ID} .
|

*Object List*: These two examples are equivalent ways of writing the
triple template for the /A Game of Thrones/ book.

|:A_Game_of_Thrones :title "A Game of Thrones"@en-US .
:A_Game_of_Thrones :title "Il Trono di Spade"@it .
|

|:A_Game_of_Thrones :title "A Game of Thrones"@en-US, "Il Trono di Spade"@it .
|


    # <#meta-mapping> Meta-Mapping

Meta-mapping assertions are syntactically the same as normal assertions,
but they allow users to include variables in the targets without
restrictions. This means that class and property names can be
constructed dynamically from the database.

/Example/: Consider the following mapping assertions:

|mappingId     mapping1
target        <{iri}> a :{value}_{code} .
source        SELECT value, iri, code FROM table1 WHERE code > 0
|

|mappingId     mapping2
target        <{iri}> :{role}_{code} {value} .
source        SELECT value, iri, code, role FROM table1 WHERE code > 0
|

Suppose we also have a table named |table1| that the mapping assertions
refer to:

iri 	value 	code 	role
iri1 	A 	1 	P
iri2 	B 	2 	P
iri3 	A 	2 	Q
iri4 	B 	2 	Q

Then |mapping1| will generate the following triples:

|iri1 a :A_1 .
iri2 a :B_2 .
iri3 a :A_2 .
iri4 a :B_2 .
|

And |mapping2| will generate the following triples:

|iri1 :P_1 A .
iri2 :P_2 B .
iri3 :Q_2 A .
iri4 :Q_2 B .
|

Edit this page <https://github.com/ontop/ontop-website/edit/master/
guide/advanced/mapping-language.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Standards compliance <https://ontop-vkg.org/guide/compliance.html>
Predefined query endpoint (beta) <https://ontop-vkg.org/guide/advanced/
predefined.html> →
```

## File: Presentation _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>
          + Requirements <https://ontop-vkg.org/tutorial/#requirements>
          + Clone this repository <https://ontop-vkg.org/tutorial/
            #clone-this-repository>
          + Program <https://ontop-vkg.org/tutorial/#program>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#presentation> Presentation

In this tutorial, we will see how to design a Virtual Knowledge Graph
(VKG) specification, how to deploy it as a SPARQL endpoint, how to
consume it and further more advanced topics.


    # <#requirements> Requirements

  * Java 11(opens new window) <http://www.oracle.com/technetwork/java/
    javase/downloads/index.html>
  * Latest version of Ontop from GitHub(opens new window) <https://
    github.com/ontop/ontop/releases> or SourceForge(opens new window)
    <https://sourceforge.net/projects/ontop4obda/files/>
  * H2 with preloaded datasets h2.zip <https://ontop-vkg.org/tutorial/
    h2.zip>
  * Git(opens new window) <https://git-scm.com/>


    # <#clone-this-repository> Clone this repository

Before start, please clone this repository in order to download all the
files

|git clone https://github.com/ontop/ontop-tutorial.git
cd ontop-tutorial
|


    # <#program> Program

 1. Basics of VKG Modeling <https://ontop-vkg.org/tutorial/basic/
    setup.html>
      * Mapping the first data source <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      * Mapping the second data source <https://ontop-vkg.org/tutorial/
        basic/university-2.html>
 2. Deploying an Ontop SPARQL endpoint <https://ontop-vkg.org/tutorial/
    endpoint>
      * Using Ontop CLI <https://ontop-vkg.org/tutorial/endpoint/
        endpoint-cli.html>
      * Using Ontop Docker image <https://ontop-vkg.org/tutorial/
        endpoint/endpoint-docker.html>
 3. Interacting with an Ontop SPARQL endpoint <https://ontop-vkg.org/
    tutorial/interact/cli.html>
      * Command Line Tools (curl, http) <https://ontop-vkg.org/tutorial/
        interact/cli.html>
      * Python and Jupyter Notebook <https://ontop-vkg.org/tutorial/
        interact/jupyter.html>
 4. Mapping Engineering <https://ontop-vkg.org/tutorial/mapping>
      * Role of primary keys <https://ontop-vkg.org/tutorial/mapping/
        primary-keys.html>
      * Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      * Choice of the URI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      * Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>
 5. Materialization using Ontop <https://ontop-vkg.org/tutorial/
    materialization/materialization.html>
      * How to materialize data into a graph database using Ontop
        <https://ontop-vkg.org/tutorial/materialization/
        materialization.html>
 6. Federating multiple databases <https://ontop-vkg.org/tutorial/
    federation>
      * Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      * Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
 7. Lenses <https://ontop-vkg.org/tutorial/lenses>
      * Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      * Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      * SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>
      * Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      * Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
 8. External tutorials <https://ontop-vkg.org/tutorial/external-tutorials>

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/README.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
setup.html> →
```

## File: Role of foreign keys _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#role-of-foreign-keys> Role of foreign keys

Foreign keys play a crucial role for optimizing the saturated mapping
assertions by doing some query containment checks.

Let us now consider the case where foreign keys are missing. Please
download the following files: university-no-fk.ttl <https://ontop-
vkg.org/tutorial/mapping/university-no-fk.ttl>, university-no-fk.obda
<https://ontop-vkg.org/tutorial/mapping/university-no-fk.obda> and
university-no-fk.properties <https://ontop-vkg.org/tutorial/mapping/
university-no-fk.properties> files.

Let us consider the case of |foaf:Person|. If you run the following
SPARQL query in the absence of foreign keys:

|PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT ?p {
  ?p a foaf:Person .
}
|

you will obtain a SQL query similar to the following one (after some
minor reformatting):

|SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni2/person/' || QVIEW1."lab_teacher") AS "p"
FROM   "uni2"."course" QVIEW1
WHERE  QVIEW1."lab_teacher" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni2/person/' || QVIEW1."lecturer") AS "p"
FROM   "uni2"."course" QVIEW1
WHERE  QVIEW1."lecturer" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/academic/' || QVIEW1."a_id") AS "p"
FROM   "uni1"."teaching" QVIEW1
WHERE  QVIEW1."a_id" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni2/person/' || QVIEW1."pid") AS "p"
FROM   "uni2"."registration" QVIEW1
WHERE  QVIEW1."pid" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/student/' || QVIEW1."s_id") AS "p"
FROM   "uni1"."course-registration" QVIEW1
WHERE  QVIEW1."s_id" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/student/' || QVIEW1."s_id") AS "p"
FROM   "uni1"."student" QVIEW1
WHERE  QVIEW1."s_id" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/academic/' || QVIEW1."a_id") AS "p"
FROM   "uni1"."academic" QVIEW1
WHERE  QVIEW1."a_id" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni2/person/' || QVIEW1."pid") AS "p"
FROM   "uni2"."person" QVIEW1
WHERE  QVIEW1."pid" IS NOT NULL
|

This SQL query is the union of eight sub-queries. Basically, it queries
the tables |uni1.student|, |uni1.academic|, |uni2.person| as expected,
but also |uni1.teaching|, |uni1.course-registration|, |uni2.course| and
|uni2.registration|. Recall that the presence of the four latter tables
is due to the fact that, according to the ontology, the respective
domains of the properties |:givesLecture|, |:givesLab| and |:attends|
are subsumed by |foaf:Person|.

With the setting of the first session which includes foreign keys, the
generated SQL query contains only three unions:

|SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/student/' || QVIEW1."s_id") AS "p"
FROM   "uni1"."student" QVIEW1
WHERE  QVIEW1."s_id" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/academic/' || QVIEW1."a_id") AS "p"
FROM   "uni1"."academic" QVIEW1
WHERE  QVIEW1."a_id" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni2/person/' || QVIEW1."pid") AS "p"
FROM   "uni2"."person" QVIEW1
WHERE  QVIEW1."pid" IS NOT NULL
|


      # <#side-note> Side note

If we now consider also the first and the last names of persons, foreign
keys are not needed to optimize the query.

Try:

|PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT ?p ?firstName ?lastName {
  ?p a foaf:Person ;
     foaf:firstName ?firstName ;
     foaf:lastName ?lastName .
}
|

and observe that the query produces only three unions.

Why? Because the domain of |foaf:firstName| and |foaf:lastName| is |
foaf:Person|. The SPARQL query can thus be safely rewritten as follow:

|PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT ?p ?firstName ?lastName {
  ?p foaf:firstName ?firstName ;
     foaf:lastName ?lastName .
}
|

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/mapping/foreign-keys.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Role of primary keys (unique constraints) <https://ontop-vkg.org/
tutorial/mapping/primary-keys.html> Choice of the IRI templates
<https://ontop-vkg.org/tutorial/mapping/uri-templates.html> →
```

## File: Role of primary keys (unique constraints) _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#role-of-primary-keys-unique-constraints> Role of primary keys
  (unique constraints)

Unique constraints (such as primary keys) are very useful for removing
self-joins and thus improving query answering performance.

Let us now consider the following files: university-no-pk.ttl <https://
ontop-vkg.org/tutorial/mapping/university-no-pk.ttl>, university-no-
pk.obda <https://ontop-vkg.org/tutorial/mapping/university-no-pk.obda>
and university-no-pk.properties <https://ontop-vkg.org/tutorial/mapping/
university-no-pk.properties> files. The mapping assertions are the same
as during the first session. The only difference is that primary keys
have been removed.

Open the new ontology file in Protégé and run the following SPARQL query:

|PREFIX : <http://example.org/voc#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT DISTINCT ?prof ?lastName {
  ?prof a :FullProfessor ;
        foaf:firstName ?firstName ;
        foaf:lastName ?lastName .
}
|

Due to the absence of primary keys, the generated SQL is, after some
minor reformatting, the following:

|SELECT *
FROM (

    SELECT 1 AS "profQuestType", NULL AS "profLang",
           ('http://example.org/uni2/person/' || QVIEW1."pid") AS "prof",
           7 AS "lastNameQuestType", NULL AS "lastNameLang",
           QVIEW3."lname" AS "lastName"
    FROM   "uni2"."person" QVIEW1,
           "uni2"."person" QVIEW2,
           "uni2"."person" QVIEW3
    WHERE  (QVIEW1."status" = 7) AND
           QVIEW1."pid" IS NOT NULL AND
           (QVIEW1."pid" = QVIEW2."pid") AND
           QVIEW2."fname" IS NOT NULL AND
           (QVIEW1."pid" = QVIEW3."pid") AND
           QVIEW3."lname" IS NOT NULL

    UNION

    SELECT 1 AS "profQuestType", NULL AS "profLang",
           ('http://example.org/uni1/academic/' || QVIEW1."a_id") AS "prof",
           7 AS "lastNameQuestType", NULL AS "lastNameLang",
           QVIEW3."last_name" AS "lastName"
    FROM   "uni1"."academic" QVIEW1,
           "uni1"."academic" QVIEW2,
           "uni1"."academic" QVIEW3
    WHERE  (QVIEW1."position" = 1) AND
           QVIEW1."a_id" IS NOT NULL AND
           (QVIEW1."a_id" = QVIEW2."a_id") AND
           QVIEW2."first_name" IS NOT NULL AND
           (QVIEW1."a_id" = QVIEW3."a_id") AND
           QVIEW3."last_name" IS NOT NULL

) SUB_QVIEW
|

In each sub-query, one can observe two self-joins, between |QVIEW1|, |
QVIEW2| and |QVIEW3|.

If you run the same query with the setting of the first session, you
will obtain the following query:

|SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni2/person/' || QVIEW1."pid" ) AS "p",
       7 AS "lastNameQuestType", NULL AS "lastNameLang",
       QVIEW1."lname" AS "lastName"
FROM   "uni2"."person" QVIEW1
WHERE  QVIEW1."pid" IS NOT NULL AND
       QVIEW1."fname" IS NOT NULL AND
       QVIEW1."lname" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/academic/' || QVIEW1."a_id" ) AS "p",
       7 AS "firstNameQuestType", NULL AS "firstNameLang",
       QVIEW1."first_name" AS "firstName",
       7 AS "lastNameQuestType", NULL AS "lastNameLang",
       QVIEW1."last_name" AS "lastName"
FROM   "uni1"."academic" QVIEW1
WHERE  QVIEW1."a_id" IS NOT NULL AND
       QVIEW1."first_name" IS NOT NULL AND
       QVIEW1."last_name" IS NOT NULL

UNION ALL

SELECT 1 AS "pQuestType", NULL AS "pLang",
       ('http://example.org/uni1/student/' || QVIEW1."s_id" ) AS "p",
       7 AS "firstNameQuestType", NULL AS "firstNameLang",
       QVIEW1."first_name" AS "firstName",
       7 AS "lastNameQuestType", NULL AS "lastNameLang",
       QVIEW1."last_name" AS "lastName"
FROM   "uni1"."student" QVIEW1
WHERE  QVIEW1."s_id" IS NOT NULL AND
       QVIEW1."first_name" IS NOT NULL AND
       QVIEW1."last_name" IS NOT NULL
|

As you can see, the self-joins are removed when primary keys are
provided and used as joining conditions.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/mapping/primary-keys.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Second session: Mapping Engineering <https://ontop-vkg.org/tutorial/
mapping/> Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
foreign-keys.html> →
```

## File: Setting up an Ontop SPARQL endpoint with Ontop CLI _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#setting-up-an-ontop-sparql-endpoint-with-ontop-cli> Setting up an
  Ontop SPARQL endpoint with Ontop CLI

 1. Download Ontop CLI(opens new window) <https://github.com/ontop/
    ontop/releases> and unzip it to a directory, which is denoted as |
    $ONTOP_CLI_DIR| below.
 2. Copy the H2 jdbc driver to |$ONTOP_CLI_DIR/jdbc| (if not done yet)
      * Mac/Linux: |cp jdbc/h2-1.4.196.jar $ONTOP_CLI_DIR/jdbc|
 3. Start the h2 database.
 4. Go to the |endpoint/| directory. Alternatively, if you don't have
    already the tutorial files, you can download this OWL ontology file
    <https://ontop-vkg.org/tutorial/endpoint/input/university-
    complete.ttl>, this mapping file <https://ontop-vkg.org/tutorial/
    endpoint/input/university-complete.obda>, this properties file
    <https://ontop-vkg.org/tutorial/endpoint/input/university-
    complete.properties> and paste them in |input/|.
 5. Start the Ontop endpoint. On Mac/Linux:

|$ONTOP_CLI_DIR/ontop endpoint \
    --ontology=input/university-complete.ttl \
    --mapping=input/university-complete.obda \
    --properties=input/university-complete.properties \
    --cors-allowed-origins=http://yasgui.org # if needed
|

On Windows:

|ontop endpoint ^
    --ontology=input/university-complete.ttl ^
    --mapping=input/university-complete.obda ^
    --properties=input/university-complete.properties ^
    --cors-allowed-origins=http://yasgui.org 
|

 6. Open the web interface of the SPARQL endpoint to try some queries:
    http://localhost:8080/(opens new window) <http://localhost:8080/>

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/endpoint/endpoint-cli.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/endpoint/>
Setting up an Ontop SPARQL endpoint with Docker <https://ontop-vkg.org/
tutorial/endpoint/endpoint-docker.html> →
```

## File: SQL Lens _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#sql-lens> SQL Lens

SQL lenses are a special type of lens that can generate virtual views
over any number of base relations through an arbitrary SQL query. While
this allows for more flexibility, as any SQL functionalities can be used
by this lens, it risks to obfuscate the inner workings towards Ontop as
it may not be handled by the Ontop's SQL parser, preventing it from
performing any meaningful inference and optimization.

One major use case for SQL lenses is to perform complex operations that
are currently not supported by other Ontop lenses. For this example, we
will look at the table |art_exhibits|. This table has the following schema:

column 	type
exhibit_id 	integer
name 	string
artist_name 	string
museum_id 	integer

We now want to gather more information on artists. Including how many
exhibits they created and in how many museums their works appear. In
SQL, this can be achieved easily by running aggregate functions on a |
GROUP BY| query, but there is no corresponding lens for aggregate
functions in Ontop. We, therefore, have to take advantage of the SQL lens.

This lens has the following structure:

|{
    "name": [String],
    "query": String,
    "type": "SQLLens"
}
|

Here, the |query| field is a single SQL query that projects all
attributes that are of interest to us. In our example, we want to group
all artists' names and count their number of exhibits and *distinct*
museums. A corresponding SQL lens could look like this:

|{
    "name": ["lenses", "artists"],
    "query": "SELECT artist_name, COUNT(exhibit_id) as exhibits, COUNT(DISTINCT museum_id) as museums FROM art_exhibits GROUP BY artist_name",
    "type": "SQLLens"
}
|

This will now create a virtual relation inside Ontop, that has the
columns |artist_name|, |exhibits|, and |museums|.


      # <#mapping> Mapping

Finally, we just need to create a mapping entry for the artist,
extending our mapping template:

|mappingId	MAPID-artists
target		data:artist/{artist_name} a :Artist ; :name {artist_name}^^xsd:string ; :exhibitCount {exhibits}^^xsd:integer ; :museumCount {museums}^^xsd:integer.
source		SELECT artist_name, exhibits, museums FROM lenses.artists;
|

NOTE

In the |target| clause of the mapping, our datatype properties have to
be marked by their individual types. This is because Ontop can no longer
infer the types of the columns we are using, as they are obfuscated by
the SQL lens.

To test our lenses and mapping, let us run the Ontop endpoint, copying
the |lenses.json| and |mapping.obda| files into the endpoint's
directory. Then, we can run the following SPARQL query:

|PREFIX : <http://example.org/museum_kg/>
SELECT ?name ?exhibits ?museums WHERE {
    ?artist a :Artist .
    ?artist :name ?name .
    ?artist :exhibitCount ?exhibits .
    ?artist :museumCount ?museums .
}
|

If everything was done correctly, you should get a list of three artists
with the number of their exhibits and the number of museums they are
featured in.


      # <#adding-unique-constraints> Adding Unique Constraints

Ontop cannot infer unique constraints from the expressions used in SQL
lenses. However, as the user, it is clear to us that the field |
artist_name| will be /unique/, as it is used by the |GROUP BY| clause.
In such cases, explicitly adding unique constraints is a useful feature.
Similarly to how it was shown in the basic lens section <https://ontop-
vkg.org/tutorial/lenses/basic-lens.html>, we can achieve this by adding
an additional field to the lens:

|{
    "relations": 
    [
        {
            "name": ["lenses", "artists"],
            "query": "SELECT artist_name, COUNT(exhibit_id) as exhibits, COUNT(DISTINCT museum_id) as museums FROM art_exhibits GROUP BY artist_name",
            "type": "SQLLens",
            "uniqueConstraints": {
                "added": [
                    {
                        "name": "uc",
                        "determinants": ["artist_name"]
                    }
                ]
            }
        }
    ]
}
|

While this will not change the output of the sample query, it may help
Ontop optimize its queries in specific instances (see primary key
<https://ontop-vkg.org/tutorial/mapping/primary-keys.html>).

WARNING

It is advised to be cautious when using SQL lenses. Generally, they
should not refer to other lenses if the SQL expression is complex, and
they may not be able to infer integrity constraints. For more
information, please visit the documentation page of lenses <https://
ontop-vkg.org/guide/advanced/lenses.html>.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/lenses/sql-lens.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-lens.html>
External tutorials <https://ontop-vkg.org/tutorial/external-
tutorials.html> →
```

## File: Union Lens _ Ontop.html
```html
Ontop <https://ontop-vkg.org/>
Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

Guide <https://ontop-vkg.org/guide/>
Tutorial <https://ontop-vkg.org/tutorial/>
Download <https://ontop-vkg.org/download/>
Community <https://ontop-vkg.org/community/>
Research <https://ontop-vkg.org/research/>
Dev <https://ontop-vkg.org/dev/>
Work with us <https://ontop-vkg.org/jobs/>
GitHub (opens new window) <https://github.com/ontop/ontop>

  *

    Tutorial

      o Presentation <https://ontop-vkg.org/tutorial/>

  *

    Basics

      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/basic/
        setup.html>
      o First data source: university 1 <https://ontop-vkg.org/tutorial/
        basic/university-1.html>
      o Second data source: university 2 <https://ontop-vkg.org/
        tutorial/basic/university-2.html>

  *

    Endpoint

      o Deploying a SPARQL endpoint <https://ontop-vkg.org/tutorial/
        endpoint/>
      o Setting up an Ontop SPARQL endpoint with Ontop CLI <https://
        ontop-vkg.org/tutorial/endpoint/endpoint-cli.html>
      o Setting up an Ontop SPARQL endpoint with Docker <https://ontop-
        vkg.org/tutorial/endpoint/endpoint-docker.html>

  *

    Interact

      o Interact with an Ontop SPARQL Endpoint <https://ontop-vkg.org/
        tutorial/interact/cli.html>
      o Use Jupyter Notebook with an Ontop SPARQL endpoint <https://
        ontop-vkg.org/tutorial/interact/jupyter.html>

  *

    Mapping

      o Second session: Mapping Engineering <https://ontop-vkg.org/
        tutorial/mapping/>
      o Role of primary keys (unique constraints) <https://ontop-
        vkg.org/tutorial/mapping/primary-keys.html>
      o Role of foreign keys <https://ontop-vkg.org/tutorial/mapping/
        foreign-keys.html>
      o Choice of the IRI templates <https://ontop-vkg.org/tutorial/
        mapping/uri-templates.html>
      o Bonus: existential reasoning <https://ontop-vkg.org/tutorial/
        mapping/existential.html>

  *

    Materialize

      o How to materialize data into a graph database <https://ontop-
        vkg.org/tutorial/materialization/materialization.html>

  *

    Federation

      o Federating multiple databases <https://ontop-vkg.org/tutorial/
        federation/>
      o Ontop with Denodo <https://ontop-vkg.org/tutorial/federation/
        denodo/>
      o Ontop with Dremio <https://ontop-vkg.org/tutorial/federation/
        dremio/>
      o Ontop with Teiid <https://ontop-vkg.org/tutorial/federation/teiid/>

  *

    Lenses

      o Using lenses <https://ontop-vkg.org/tutorial/lenses/>
      o Database and Ontop Setup <https://ontop-vkg.org/tutorial/lenses/
        setup.html>
      o Basic Lens <https://ontop-vkg.org/tutorial/lenses/basic-lens.html>
      o Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
      o Union Lens <https://ontop-vkg.org/tutorial/lenses/union-lens.html>
          + Relations with the same schema <https://ontop-vkg.org/
            tutorial/lenses/union-lens.html#relations-with-the-same-schema>
          + Relations with different schemas <https://ontop-vkg.org/
            tutorial/lenses/union-lens.html#relations-with-different-
            schemas>
      o Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-
        lens.html>
      o SQL Lens <https://ontop-vkg.org/tutorial/lenses/sql-lens.html>

  *

    Others

      o External tutorials <https://ontop-vkg.org/tutorial/external-
        tutorials.html>


  # <#union-lens> Union Lens

/Union lenses will be supported starting with version 5.1.0 (beta)./

Union lenses can be used to concatenate multiple relations with the same
schema into one. Additionally, a /provenance/ field can be added to each
row, determining the source relation the row originates from.

For this example, we will look at the tables |nature_exhibits|, |
historical_exhibits| and |art_exhibits| from the DuckDB database. We
want to combine them into a single relation containing all exhibits.

The tables |nature_exhibits| and |historical_exhibits| have the
following schema:

column 	type
exhibit_id 	integer
name 	string
museum_id 	integer

The table |art_exhibits| has the following schema:

column 	type
exhibit_id 	integer
name 	string
artist_name 	string
museum_id 	integer

For each table, |exhibit_id| is a primary key and |museum_id| is a
foreign key, referencing the table |museums|.


    # <#relations-with-the-same-schema> Relations with the same schema

This concatenation can be achieved using a union lens. However, as all
base relations of a union lens must have the exact same columns, we will
only be working on the tables |nature_exhibits| and |
historical_exhibits| at first.

The union lens has the following structure:

|{
    "name": [String],
    "unionRelations": [[String]],
    "makeDistinct": boolean,
    "provenanceColumn": String,
    "type": "UnionLens"
}
|

Here, |unionRelations| is a list of relations that should be
concatenated, |makeDistinct| indicates if a distinct constraint should
be enforced on the result, and |provenanceColumn| is an optional
parameter, indicating the name of the provenance column in the result,
which tells us what relation each row originated from.

As the tables |nature_exhibits| and |historical_exhibits| have the same
set of columns, we can reference them from a union lens to create a new,
concatenated view.

WARNING

The columns of all tables used by a union lens must be /exactly/ equal.
Their columns must have /the same names/ and the *exact* /same data
types/. The order of the columns does not matter.

|{
    "relations": [
        {
            "name": ["lenses", "all_exhibits"],
            "unionRelations": [
                ["historical_exhibits"],
                ["nature_exhibits"]
            ],
            "provenanceColumn": ...,
            "makeDistinct": ...,
            "type": "UnionLens"
        }
    ]
}
|

The remaining fields are |provenanceColumn| and |makeDistinct|. As we do
not expect the entries of any of the tables to be equal, we can just
neglect the |makeDistinct| parameter. To preserve the source of each
entry, we want to include a provenance column. We can call it |
exhibit_type|. This results in the following |lenses.json| file:

|{
    "relations": [
        {
            "name": ["lenses", "all_exhibits"],
            "unionRelations": [
                ["historical_exhibits"],
                ["nature_exhibits"]
            ],
            "provenanceColumn": "exhibit_type",
            "type": "UnionLens"
        }
    ]
}
|

NOTE

If the |provenanceColumn| field is not provided, then no information on
the source relation will be preserved for the concatenated rows. If the
field |makeDistinct| is not provided, its default value is assumed to be
|false|.

NOTE

Including a |provenanceColumn| in a UnionLens where each of the source
relations is distinct will render the |makeDistinct| field redundant.
This is because, under a union, the composite uniqueness constraint |
(provenanceColumns, childUniquenessConstraint)| will always hold. On the
other hand, if no provenance column is included, then uniqueness
constraints from the base relations will be lost, as there is no
guarantee that a specific value does not appear again in a different table.


      # <#mapping> Mapping

Now, let us use this lens definition in our mapping. Starting from the
mapping template file, add the following mapping entry:

|mappingId	MAPID-exhibits
target		data:exhibit/{exhibit_id} a :Exhibit ; :name {name} ; :displayedIn data:museum/{museum_id} ; :exhibitType {exhibit_type} .
source		SELECT exhibit_id, name, museum_id, exhibit_type FROM lenses.all_exhibits;
|

Starting the Ontop SPARQL endpoint using this mapping and lens file, we
can now run the SPARQL query:

|PREFIX : <http://example.org/museum_kg/>
SELECT ?name ?type WHERE {
    ?exhibit a :Exhibit .
    ?exhibit :name ?name .
    ?exhibit :exhibitType ?type .
}
|

This should result in a set of exhibit names that have the values |
historical_exhibits| and |nature_exhibits| as their exhibit type.


    # <#relations-with-different-schemas> Relations with different schemas

If we further want to include the table |art_exhibits| to the union
lens, we cannot just add it to the list of |unionRelations|. This is
because it has one additional column, |artist_name|, that does not
appear in the other tables. To work around this issue, we can take
advantage of basic lenses, putting them "underneath" the union lens, to
ensure the equality of columns.

There are two possibilities to achieve this:

 1. Hide the conflicting column(s) from its/their table(s)
 2. Add the conflicting column(s) to the tables that do not include them.

To retain a maximum of information, we will choose the second approach
for this example. That means, that we have to construct basic lenses to
add the column |artist_name| to the tables |historical_exhibits| and |
nature_exhibits|. One possible way to achieve this is by adding new
columns that have |NULL| as their expressions.

|{
    "relations": [
        {
            "name": ["lenses", "historical_exhibits_extended"],
            "baseRelation": ["historical_exhibits"],
            "columns": {
                "added": [
                    {
                        "name": "artist_name",
                        "expression": "'None'"
                    }
                ],
                "hidden": []
            },
            "type": "BasicLens"
        }
    ]
}
|

After doing the same for the |nature_exhibits| table, referencing the
new extended lenses from the union lens, and adding |art_exhibits| as
one of its union relations, get the following lens file:

|{
    "relations": [
        {
            "name": ["lenses", "historical_exhibits_extended"],
            "baseRelation": ["historical_exhibits"],
            "columns": {
                "added": [
                    {
                        "name": "artist_name",
                        "expression": "'None'"
                    }
                ],
                "hidden": []
            },
            "type": "BasicLens"
        },
        {
            "name": ["lenses", "nature_exhibits_extended"],
            "baseRelation": ["nature_exhibits"],
            "columns": {
                "added": [
                    {
                        "name": "artist_name",
                        "expression": "'None'"
                    }
                ],
                "hidden": []
            },
            "type": "BasicLens"
        },
        {
            "name": ["lenses", "all_exhibits"],
            "unionRelations": [
                ["lenses", "historical_exhibits_extended"],
                ["lenses", "nature_exhibits_extended"],
                ["art_exhibits"]
            ],
            "provenanceColumn": "exhibit_type",
            "type": "UnionLens"
        }
    ]
}
|


      # <#mapping-2> Mapping

We can now extend the mapping file to also include artist names:

|mappingId	MAPID-exhibits
target		data:exhibit/{exhibit_id} a :Exhibit ; :name {name} ; :displayedIn data:museum/{museum_id} ; :exhibitType {exhibit_type} ; :artistName {artist_name} .
source		SELECT exhibit_id, name, museum_id, exhibit_type, artist_name FROM lenses.all_exhibits;
|

Now, running this slightly modified SPARQL query:

|PREFIX : <http://example.org/museum_kg/>
SELECT ?name ?type ?artist WHERE {
    ?exhibit a :Exhibit .
    ?exhibit :name ?name .
    ?exhibit :exhibitType ?type .
    ?exhibit :artistName ?artist
}
|

we will once again get all earlier results, in addition to all exhibits
contained in the |art_exhibit| table. While the earlier results will
have the value |None| as their artist name, the |art_exhibits| entries
will include the name of their artists.

------------------------------------------------------------------------

As a further exercise, notice how the values of |:exhibitType| are
rather ugly: |"art_exhibits"|, |"lenses.historical_exhibits_extended"|,
and |"lenses.nature_exhibits_extended"|. Try adding a new basic lens
over the union lens that transforms these into the values |"art"|,
|"historical"|, and |"nature"| instead.

/Hint: Look at the SQL function |REPLACE|. Could it be used in the |
expression| field of an added column to get rid of the |_exhibits|, |
_extended|, and |lenses.| part?/

Notice how the union lens allowed you to perform this operation on all
three of its base relations by just defining it once. Without the union
lens, you would have required three such basic lenses, one for each
table, with the exact same contents.

Edit this page <https://github.com/ontop/ontop-website/edit/master/
tutorial/lenses/union-lens.md> (opens new window)
Last Updated: 11/6/2025, 11:53:16 AM

← Join Lens <https://ontop-vkg.org/tutorial/lenses/join-lens.html>
Flatten Lens <https://ontop-vkg.org/tutorial/lenses/flatten-lens.html> →
```
