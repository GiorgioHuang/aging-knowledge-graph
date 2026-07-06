# Data License — CC BY 4.0

The **knowledge data** in this repository — the curated graph under `seed/`
(nodes, claims, evidence) and the knowledge content in `docs/` — is licensed
under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** license:
https://creativecommons.org/licenses/by/4.0/

You are free to share and adapt this data for any purpose, provided you give
appropriate credit to **Healthy Aging Knowledge**.

## Scope & split

- **Code** (everything else: `src/`, `scripts/`, `db/`, config) is licensed under
  the **MIT License** (see [`LICENSE`](LICENSE)).
- **Data & documentation** are licensed under **CC BY 4.0** (this file).

## Third-party vocabularies and sources

External identifiers (`external_ids` CURIEs) and cited sources remain under their
own licenses. Per [`docs/10-standards-alignment.md`](docs/10-standards-alignment.md),
the open dataset carries **only open-licensed codes**; license-restricted
vocabularies (SNOMED CT, ICD-11 crosswalks, ATC) are referenced, not redistributed.
Evidence quotes are short excerpts used for citation/identification.

> This split (MIT code + CC BY 4.0 data) was chosen at V0 to honor the charter's
> "open by default" commitment. It can be revisited before any public release.
