# Phishing Protection Simulator

Flask + SQLite + Jinja training game. Single-player defender completes a bank transfer without falling for phishing; a two-player **Versus mode** adds a live attacker who can trigger traps in real time.

## Running

```bash
pip install -r requirements.txt
export SECRET_KEY=$(python -c 'import secrets; print(secrets.token_urlsafe(32))')
python app.py           # http://localhost:5000
```

The `SECRET_KEY` env var seeds Flask's session cookie signing. If unset, the app falls back to an insecure dev key and will print no warning — **always set it in any shared environment.**

Override the DB path with `PHISHSIM_DB=/path/to/file.db`.

## Versus mode (two-player)

One defender, one attacker. The defender runs the normal mission; the attacker gets a Red Ops console and can trigger live attacks against the defender's screen.

### How to play locally

**Two browsers on one machine** (quickest for testing):
1. Player A: open `http://localhost:5000/pvp` in a **regular window**, click **Create room**, pick a role.
2. Player B: open the same URL in an **incognito/private window** (so Flask cookies don't collide), click **Join**, enter the room code shown to A.
3. Once both are in the lobby, either player clicks **Start match**.

**Two machines on the same LAN:**
1. On the host machine: `python app.py` (binds `0.0.0.0:5000`).
2. Find the host's LAN IP (`ipconfig` / `ifconfig`).
3. The other machine opens `http://<host-ip>:5000/pvp` and joins with the code.

### Roles

- **Defender** lands in the normal desktop shell and plays the mission exactly as single-player.
- **Attacker** is redirected to `/attacker/<code>` — the Red Ops console showing the defender's coarse stage (`Inbox`, `Browser`, `Dashboard`, …), cooldowns, and a live event feed.

### Win conditions

- Defender completes the $500 transfer → **defender wins**.
- Defender trips any lose condition (phishing link, fake login, scam popup, weak password) → **attacker wins**.
- Match status is frozen once decided; both players see the result page.

### Abilities (v1)

| Ability              | Cooldown | Stage gate        | Effect on defender                                   |
| -------------------- | -------- | ----------------- | ---------------------------------------------------- |
| Lottery scam         | 25s      | Dashboard only    | Fake $1M-prize popup, clickable bait                 |
| Verification scam    | 25s      | Dashboard only    | SSN/card overlay form, clickable bait                |
| Urgent banner        | 15s      | None              | Red banner slides in at the top of the defender's UI |

Server enforces every constraint. The client sends only an enumerated `effect_type` — no free-form strings cross the trust boundary.

## New / changed routes

| Method | Path                             | Purpose                                            |
| ------ | -------------------------------- | -------------------------------------------------- |
| GET    | `/pvp`                           | Landing (create or join)                           |
| POST   | `/pvp/create`                    | Create match, assign creator's role                |
| POST   | `/pvp/join`                      | Join by room code, assigned the open role          |
| GET    | `/pvp/room/<code>`               | Lobby (shows readiness, Start button)              |
| POST   | `/pvp/start/<code>`              | Flip match to `active` (either participant)        |
| GET    | `/pvp/result/<code>`             | End-of-match summary                               |
| GET    | `/attacker/<code>`               | Attacker console (role-gated)                      |
| GET    | `/api/match/<code>/state`        | Both poll: status / winner / coarse defender stage |
| POST   | `/api/match/<code>/stage`        | Defender reports its current page-stage            |
| GET    | `/api/match/<code>/effects`      | Defender poll: drain unconsumed effects            |
| POST   | `/api/match/<code>/ability`      | Attacker triggers a whitelisted effect             |
| GET    | `/api/match/<code>/cooldowns`    | Attacker polls per-ability remaining cooldowns     |

**Modified:** `win()` and `lose()` now mark the bound match's winner. `dashboard` route passes `pvp_defender=True` to suppress single-player auto-popups (the attacker fires them instead).

## Schema additions (see `app.py` DDL block)

```sql
CREATE TABLE matches (
    id, room_code UNIQUE, status, defender_token, attacker_token,
    defender_stage, winner, loss_reason,
    created_at, started_at, ended_at
);
CREATE TABLE match_effects (
    id, match_id, effect_type, payload, consumed, created_at
);
CREATE TABLE match_cooldowns (
    match_id, effect_type, last_used_at   -- PRIMARY KEY(match_id, effect_type)
);
```

## Security model (v1)

- Role proof: random 32-byte `secrets.token_urlsafe(24)` per role, stored server-side on the match row and mirrored into the Flask session under `match:<code>:token`. Every mutating endpoint verifies session token == DB token for the claimed role.
- No cross-match abuse: tokens are match-scoped. Joining a different room doesn't give you the other room's privileges.
- Attacker inputs: only an enum `effect_type` is accepted. Server owns cooldowns, stage gating, and payload generation.
- Transport: polling every 1.5s. No WebSocket state to hijack.

## What's intentionally out of scope for v1

- No Flask-SocketIO (polling is fast enough for this use case).
- No attacker-authored strings in popups (would require sanitization; keep v1 safe).
- No matchmaking queue / leaderboards.
- Attacker can't see fine-grained defender state like "which email they're hovering" (fairness).

## Manual acceptance tests

1. A opens `/pvp`, creates a room as defender — gets code, lands in lobby.
2. B opens `/pvp` (incognito), joins with the code — auto-assigned attacker, lands in lobby.
3. Either clicks **Start** → defender is taken to `/` (mission), attacker to `/attacker/<code>`.
4. Attacker fires **Urgent banner** → defender sees banner slide in within ~1.5s.
5. Defender navigates to dashboard; attacker's lottery/verify abilities unlock.
6. Defender clicks the scam bait → loses → attacker's console redirects to result, showing attacker win.
7. Alternate run: defender completes transfer without clicking bait → wins → both see defender result.
