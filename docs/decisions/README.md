# Architecture Decision Records

Long-lived choices that shaped the project. Format: `NNN-short-title.md`. One file per decision. Short — a few paragraphs is enough.

When to write one:

- The choice was contentious or surprising and a future reader will ask "why this and not X?"
- The choice is load-bearing: changing it means rewriting a significant chunk of the system.
- The choice rules something out permanently (e.g., "we will not add a web UI").

When **not** to write one:

- The choice is obvious from the code.
- The choice is a fashion or coding-style preference.
- It's a bug fix or a small refactor.

## Index

- [001 — libSQL over better-sqlite3](001-libsql-over-better-sqlite3.md)
