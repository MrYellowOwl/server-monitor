# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Application

```bash
# Via systemd (preferred in production):
systemctl start server-monitor
systemctl status server-monitor
journalctl -u server-monitor -f

# Manual / debug mode:
source venv/bin/activate
python app.py
```

Configuration is via environment variables — set in the systemd unit file (`/etc/systemd/system/server-monitor.service`):
- `SM_PASSWORD` — plaintext password hashed at startup (default: `admin`)
- `SM_SECRET` — Flask session secret (auto-generated if absent)

After editing the service file: `systemctl daemon-reload && systemctl restart server-monitor`

## Architecture

Flask web app (port 6969) providing a password-protected admin dashboard for a Linux server. No build step, no frontend framework — pure Flask + vanilla JS.

**Request flow:** browser → `app.py` (auth + routing) → `modules/` (data) → JSON response → `dashboard.js` (render)

### Key files

| File | Role |
|---|---|
| `app.py` | Flask app, `@require_auth` decorator, 10 API endpoints |
| `config.py` | Port, domain, service whitelist, log path whitelist |
| `modules/health.py` | psutil wrappers — CPU, memory, disk, network, processes |
| `modules/security.py` | Shell commands — `ss`, `w`, `ufw`, `last`, SSL cert check, optional WordPress table query via PHP subprocess |
| `modules/actions.py` | Mutating actions — UFW block/unblock, systemctl service control, `kill()` |
| `static/dashboard.js` | Poll loop (3 s health, 8 s services), canvas CPU graph, tab-lazy-loaded security data |
| `templates/index.html` | Six-tab dashboard UI |

### Security model

- Single-password session auth; brute-force lockout (5 attempts / 300 s per IP, in-memory)
- All mutating actions enforce whitelists: `config.SERVICES` for service control, `config.LOG_PATHS` for log tails, IPv4 regex + octet-range check before any `ufw` call
- Process kill refuses PID ≤ 1 and catches `PermissionError`
- Frontend uses `escHtml()` before any DOM insertion to prevent XSS

### Patterns to follow

- Module functions return plain dicts (serialized to JSON by the endpoint)
- Broad `try/except` in modules — fail gracefully, return empty data rather than propagating
- Network I/O rates are derived by diffing against `_prev_net` / `_prev_net_time` globals in `health.py`
- Destructive frontend actions require modal confirmation before firing

## No test suite or linter

There is no pytest, flake8, or Makefile. Validate changes by running `python app.py` and exercising the UI manually.
