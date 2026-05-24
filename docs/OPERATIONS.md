# Operations

Runbook for day-to-day operation of apsolut-cortex on a development machine.

> **Path invariant:** all data lives under `~/.apsolut-cortex/`. `~/.apsolut/` (without the `-cortex` suffix) is **reserved for other `apsolut-*` tools** and must never be touched by this plugin.

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

## Audit (lint pass)

> Filled in by M8. Run weekly: `apsolut-cortex audit` reports near-duplicates, contradiction candidates, orphan tags, stale high-trust memories, and low-trust high-use memories. Read-only by default; `--apply` executes suggested merges/demotions.

## Provider health

> Filled in by M7. The compression router probes each configured provider on startup; tier merging and circuit-breaker fallback are documented there.

## Common issues

> Filled in as they're discovered.
