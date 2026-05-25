# Security policy

## Supported versions

Only the latest minor release line is supported. cortex is in active Phase 2 development and pre-1.0 — older lines do not get backports.

| Version | Supported |
|---------|-----------|
| `0.12.x` | ✅ Current |
| `< 0.12` | ❌ Please upgrade |

## What to report

apsolut-cortex stores conversation excerpts, project metadata, and (optionally) embedded text in a local libSQL database. Issues worth reporting:

- A way to read another project's memories from a project that should not have access.
- A way to leak the encryption key out of the OS keychain.
- A path where a malicious tool output, transcript, or filename leads to code execution outside the intended sandbox.
- A way to make any cortex command silently overwrite the user's `memory.db` without going through `backup` / `restore`.
- Any path that exposes `<private>` tag contents that should have been stripped before storage.

Out of scope:

- The DB file being readable when **encryption is opt-in and not enabled** — that's documented behavior.
- The opt-in encryption being defeated by an attacker who already has the OS keychain unlocked (encryption protects against laptop theft, not a logged-in adversary).
- Compression sending tool output to the configured LLM provider (Anthropic / Ollama) — that's documented behavior and you can disable it by leaving `ANTHROPIC_API_KEY` unset and not running Ollama.

## How to report

**Do not open a public GitHub issue.** Use one of:

1. GitHub's private vulnerability reporting: <https://github.com/apsolut/apsolut-cortex/security/advisories/new>
2. Email the maintainer (preferred for time-sensitive issues; address in the repo's `package.json` author or homepage).

Please include:

- The cortex version (`apsolut-cortex --help` shows it).
- Your platform (Windows native / WSL2 / macOS / Linux).
- A minimal repro — ideally a sequence of CLI commands, with any sensitive paths anonymized.
- The impact, in your own words.

Acknowledgement target: within 7 days. Fix or mitigation target: within 30 days for high-impact issues. We'll coordinate on a public disclosure date with you.

## Threat model context

cortex is designed for single-user single-machine use. It is not hardened against multi-tenant or hostile-local-user scenarios. If you need either, wait for a 1.0 cut or open a discussion about your use case.
