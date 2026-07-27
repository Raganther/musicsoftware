# Research

Where ideas live before they're code, and what we learned after.

Three kinds of thing go here, and it's worth keeping them apart:

| Folder | What it holds | When to write it |
| --- | --- | --- |
| `topics/` | Durable reference on a subject — how something works, prior art, techniques. | When you've read enough to explain it to yourself later. |
| `log/` | Dated entries: what you tried, what it sounded like, what you'd do next. | After a session at the sandbox. |
| `ideas.md` | One-line prompts you don't want to lose. | The moment you think of it. |

## Why bother

The sandbox produces a lot of near-misses. Six months from now the useful
artefact isn't the sketch that didn't work — it's the sentence explaining
*why* it didn't. Sketches also carry a `notes` field for findings tied to that
specific sketch; use `log/` for anything that spans several.

## Conventions

- Markdown, no front-matter ceremony.
- Log entries: `log/YYYY-MM-DD-short-slug.md`. Copy `log/TEMPLATE.md`.
- Link to sketches by id, e.g. `sketches/euclidean-drift`.
- Record the seed. Generative results are worthless if you can't get them back.
- Cite sources with a URL. "I read somewhere that…" is not a finding.
