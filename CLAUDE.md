# Testwise – agent notes

## Oracle VM (production backend)
- Host `161.118.171.193`, user `ubuntu`, Ubuntu 24.04 ARM (4 OCPU/24 GB), OCI Mumbai, instance `sptc-backend`. Passwordless sudo.
- **Access:** `ssh testwise` (aliases: `sptc-backend`, `oracle`). Key: `~/.ssh/oracle_sptc_backend` (ed25519, mode 600), configured in `~/.ssh/config`.
  The key is NOT in git (`oracle_*.txt` is gitignored; a copy sits in the repo root – never commit/paste it). Without the alias:
  `ssh -i ~/.ssh/oracle_sptc_backend ubuntu@161.118.171.193`
- **Helper:** `deploy/oracle/vm.sh [sh|ps|logs <svc>|psql|sync|deploy]`.
- App lives in `/opt/testwise` (Docker Compose: caddy, api1, api2, worker, livekit, postgres, redis). Public URL https://testwise.duckdns.org.
  Full runbook: `docs/DEPLOY-ORACLE.md`. Secrets are in `/opt/testwise/{.env,app.env,seed.env}` on the VM – read them there when needed, don't copy into the repo.
- `/opt/sptc-finance` is a different project on the same VM – don't touch it.
- Nightly DB backup via cron 02:30 → `/opt/testwise/backups`.
- Ask before: `deploy`, restarting containers, DB writes/restores, firewall changes.
