# Server Monitor

A lightweight, self-hosted server monitoring dashboard built with Flask. Provides real-time visibility into system health, security events, services, and logs through a password-protected web UI.

![Python](https://img.shields.io/badge/python-3.10+-blue) ![Flask](https://img.shields.io/badge/flask-2.3+-lightgrey) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Overview** — Live CPU, memory, swap, load average, disk usage, disk I/O rates, and network throughput
- **History** — 24-hour time-series charts for CPU, memory, and swap (recorded every 60 seconds)
- **Processes** — Top processes by CPU with live filtering and SIGTERM kill action
- **Security** — SSH failure tracking with top offending IPs, active sessions with source IPs, listening ports, established connections, SSL certificate status, login history, and sudo usage
- **Firewall** — UFW status, rule listing, and IP block/unblock actions
- **Services** — Start/stop/restart whitelisted systemd services with inline journal log viewer
- **Logs** — Tail and filter system log files
- **Alerts** — Threshold-based alert bar (CPU >90%, memory >85%, disk >90%, swap >80%) with optional browser notifications

## Requirements

- Python 3.10+
- Linux (tested on Ubuntu 22.04+)
- `ufw`, `ss`, `journalctl`, `last`, `w` available in PATH
- `systemd` for service management

## Installation

```bash
git clone https://github.com/youruser/server-monitor.git /opt/server-monitor
cd /opt/server-monitor
bash setup.sh
```

`setup.sh` creates a virtualenv, installs dependencies, installs the systemd unit, and opens port 6969 in UFW if active.

## Configuration

All configuration is via environment variables, set in `/etc/systemd/system/server-monitor.service`:

| Variable | Default | Description |
|---|---|---|
| `SM_PASSWORD` | `admin` | Dashboard password — **change this** |
| `SM_SECRET` | random | Flask session secret key |
| `SM_PORT` | `6969` | Port to listen on |
| `SM_DOMAIN` | _(none)_ | Domain for SSL certificate check (e.g. `example.com`) |
| `SM_WP_PATH` | _(none)_ | Absolute path to WordPress root for WP rate-limit panel (optional) |

After editing the service file:
```bash
systemctl daemon-reload && systemctl restart server-monitor
```

## Running manually

```bash
source venv/bin/activate
SM_PASSWORD=yourpassword SM_DOMAIN=example.com python app.py
```

## Customising the service whitelist

Edit `config.py` to add or remove services from the management panel:

```python
SERVICES = ['apache2', 'nginx', 'mysql', 'ssh', ...]
```

Add log files to the log viewer the same way via `LOG_PATHS`.

## Security notes

- Single-password authentication with brute-force lockout (5 attempts per 5 minutes per IP)
- All mutating actions (UFW, service control, process kill) enforce server-side whitelists
- Change the default password before exposing the dashboard to any network

## License

MIT
