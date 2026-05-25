# Operations

Runbook for day-to-day operation of apsolut-cortex on a development machine.

> **Path invariant:** all data lives under `~/.apsolut-cortex/`. `~/.apsolut/` (without the `-cortex` suffix) is **reserved for other `apsolut-*` tools** and must never be touched by this plugin.

## Hook setup

Two installable hook sets — pick one. `init` is the safe default for everyone; `install-hooks` is the M6 opt-in upgrade for power users.

```bash
apsolut-cortex init                 # legacy hook set: SessionStart + PostToolUse + Stop + SessionEnd
apsolut-cortex install-hooks        # M6 set: adds PreCompact + token-budget background worker
```

`install-hooks` is idempotent — it strips any prior cortex entry in `~/.claude/settings.json` before adding the M6 commands, and leaves other tools' hooks alone. Restart Claude Code for the change to take effect.

## Migrations

Run pending schema migrations:

```bash
apsolut-cortex migrate
```

Migrations also run automatically on every CLI/MCP startup, so manual invocation is rarely needed. Use it when bringing an older DB up to date without running the rest of the toolchain. See [STORAGE.md](STORAGE.md) for schema details.

## Backup & restore

Snapshots are physical copies of `memory.db` under `~/.apsolut-cortex/backup/`. If encryption is enabled the snapshot is encrypted at rest (the file *is* the ciphertext).

```bash
apsolut-cortex backup                            # writes manual-<ts>.db
apsolut-cortex restore                           # lists snapshots, newest first
apsolut-cortex restore <path-to-snapshot> --yes  # overwrites memory.db
```

Restore always takes a *pre-restore* safety snapshot first, so a wrong `--yes` can still be undone.

## Encryption at rest (opt-in)

The DB is plaintext by default. To encrypt:

```bash
apsolut-cortex db re-encrypt          # shows the plan, no changes made
apsolut-cortex db re-encrypt --yes    # generates key, snapshots, re-encrypts
```

What happens behind the scenes:
1. A 256-bit key is generated and stored in the OS keychain (Windows Credential Manager on native Windows, libsecret on WSL2 — for WSL2 you may need to run `gnome-keyring-daemon --start --components=secrets` first). Service `apsolut-cortex`, account `db-encryption-key`.
2. The current DB is snapshotted to `backup/pre-encrypt-<ts>.db`. **This snapshot is never deleted.**
3. A fresh encrypted DB is created next to the live one and populated row-by-row from the original.
4. The live DB is atomically replaced with the encrypted copy.

If anything fails before step 4, the original DB is untouched. The pre-encrypt snapshot is your insurance — `cp ~/.apsolut-cortex/backup/pre-encrypt-<ts>.db ~/.apsolut-cortex/memory.db` reverts.

Once encryption is enabled, **deleting the keychain entry destroys access to your memories.** Don't run `apsolut-cortex uninstall` and then nuke the keyring; export the key to a password manager first if you want to keep the option of restoring later.

## Nightly snapshots

> Cron / Task Scheduler entries: not wired automatically yet. To schedule manual snapshots, run `apsolut-cortex backup` on a schedule via Windows Task Scheduler or WSL cron. Rotation (7 daily / 4 weekly / 3 monthly) is a planned later feature.

## Curation (M5)

Individual memory hygiene from the terminal — no need to touch sqlite3:

```bash
apsolut-cortex grep <pattern>           # substring search across this project
apsolut-cortex promote <id>             # walk trust tier: observed → validated → proven → canonical
apsolut-cortex demote <id>              # walk it back down
apsolut-cortex tag <id> <tag>           # free-form labels (lowercased, deduped)
apsolut-cortex untag <id> <tag>
apsolut-cortex correct                  # flag the most recent retrieval as a miss
apsolut-cortex correct --with "answer"  # …and store the fix as a linked memory (M2)

# Bulk delete (every filter shows a preview and refuses without --yes)
apsolut-cortex delete --id <id>
apsolut-cortex delete --project <project-id> --yes
apsolut-cortex delete --tag <name> --yes
apsolut-cortex delete --before YYYY-MM-DD --yes
apsolut-cortex delete --grep <pattern> --yes
# filters combine with AND. raw SQL is intentionally not accepted.
```

## Vault export (M5)

The Obsidian-friendly markdown vault regenerates on every `SessionEnd`; you can also run it on demand:

```bash
apsolut-cortex export                   # writes ~/.apsolut-cortex/obsidian/
```

Layout — see [STORAGE.md](STORAGE.md#directory-layout) for full detail. Open `~/.apsolut-cortex/obsidian/` as an Obsidian vault to browse, then use the `_health.md` page to spot memories that need `promote` / `demote`.

## Audit (lint pass)

> Filled in by M8. Run weekly: `apsolut-cortex audit` reports near-duplicates, contradiction candidates, orphan tags, stale high-trust memories, and low-trust high-use memories. Read-only by default; `--apply` executes suggested merges/demotions.

## Provider health

> Filled in by M7. The compression router probes each configured provider on startup; tier merging and circuit-breaker fallback are documented there.

## Common issues

> Filled in as they're discovered.
