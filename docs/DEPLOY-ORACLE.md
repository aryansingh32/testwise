# Deploying Testwise on the Oracle Cloud VM

Live at **https://testwise.duckdns.org** (Oracle `VM.Standard.A1.Flex`, 4 OCPU / 24 GB, Ubuntu 24.04 ARM, Mumbai).
Everything runs in Docker Compose from `/opt/testwise` on the VM. Files: `deploy/oracle/` in this repo.

## Layout

| Container | Role |
|---|---|
| `testwise-caddy` | host network, ports 80/443, automatic HTTPS, serves the admin console, routes traffic |
| `testwise-api1`, `testwise-api2` | stateless HTTP API replicas (loopback 4001/4002), load balanced by Caddy |
| `testwise-worker` | owns the duel engine + answer analysis + all Socket.IO (loopback 4010) |
| `testwise-livekit` | live proctoring video: signalling via Caddy `/livekit`, media on 7881/tcp + 7882/udp |
| `testwise-postgres` (17), `testwise-redis` (7) | data; internal network only, never published |

Routing: `/socket.io/*` → worker, `/livekit/*` → LiveKit, `/v1/*` `/health` `/verify/*` `/uploads/*` → API replicas, everything else → admin SPA.
Mobile app API URL: `https://testwise.duckdns.org`.

## Files on the VM (`/opt/testwise`)
`.env` (compose variables) · `app.env` (app secrets) · `seed.env` (initial admin login; delete after first login) — all mode 600 · `src/` (synced source) · `backups/` (nightly dumps, 14 days).
Admin login: read `seed.env` (`ssh … 'cat /opt/testwise/seed.env'`).

## Operate
```bash
cd /opt/testwise; C="sudo docker compose --env-file .env -f src/deploy/oracle/docker-compose.yml"
$C ps                       # status
$C logs -f --tail 100 api1  # logs
$C up -d --build            # redeploy after syncing new source into src/ (migrations run automatically)
$C restart api1 && $C restart api2   # rolling restart (Caddy drains a replica that reports 503 on /health)
sudo docker exec testwise-postgres psql -U testwise testwise      # SQL shell
/opt/testwise/src/deploy/oracle/backup.sh                          # manual backup
gunzip -c /opt/testwise/backups/FILE.sql.gz | sudo docker exec -i testwise-postgres psql -U testwise testwise   # restore
```
Redeploy from a dev machine: `rsync -a --relative` the allow-list `package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json packages/shared apps/api apps/admin apps/mobile/package.json deploy/oracle` (excluding `node_modules dist .env* secrets uploads private-uploads`) to `/opt/testwise/src/`, then `up -d --build`.

## Network
Host firewall (iptables, persisted): 22, 80, 443, 7881/tcp, 7882/udp. Oracle security list must also allow the same (+ nothing else). LiveKit's 7880 stays private.

## Firebase
Configured: project `testwisee` token verification + FCM push + Play Integrity credentials (`/opt/testwise/secrets/firebase-adminsdk.json`, uid 1000, mode 600, mounted read-only). Google login is enabled in Firebase and switched on in Admin → Settings → Login methods.
**Phone OTP is off**: it is not enabled in the Firebase console yet (enable Phone, then switch it on in Settings; SMS volume may need the Blaze plan). Add the **Play app-signing SHA-1/SHA-256** to the Android app in Firebase before shipping, or Google sign-in will fail in release builds. iOS push needs an APNs key (`APNS_*`).

## Not configured yet
Razorpay (payments run on the MOCK gateway) · Play Integrity / App Attest · SSH hardening (planned: fail2ban + Tailscale) · TURN for restrictive networks.

## Previous project
The old SPTC Finance stack (`/opt/sptc-finance`, compose project `oracle`) is **stopped, not deleted**: `sudo docker start sptc-postgres sptc-backend sptc-caddy`. It uses the same ports, so stop Testwise's `caddy` first.
