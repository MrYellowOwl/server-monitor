import json, time, urllib.request
import config

_active = set()

def check_and_notify(h):
    current = {}
    if h['cpu']['percent'] >= config.ALERT_CPU:
        current['cpu'] = f"CPU at {h['cpu']['percent']:.1f}%"
    if h['memory']['percent'] >= config.ALERT_MEM:
        current['mem'] = f"Memory at {h['memory']['percent']:.1f}%"
    if h['memory']['swap_total'] > 0 and h['memory']['swap_percent'] >= config.ALERT_SWAP:
        current['swap'] = f"Swap at {h['memory']['swap_percent']:.1f}%"
    for disk in h.get('disks', []):
        if disk['percent'] >= config.ALERT_DISK:
            current[f"disk:{disk['mountpoint']}"] = f"Disk {disk['mountpoint']} at {disk['percent']}%"

    for key, msg in current.items():
        if key not in _active:
            _discord(f"🚨 **ALERT** — {msg}", 0xff4444)

    for key in list(_active):
        if key not in current:
            _active.discard(key)
            label = key.replace('disk:', 'Disk ').replace('cpu', 'CPU').replace('mem', 'Memory').replace('swap', 'Swap')
            _discord(f"✅ **RESOLVED** — {label}", 0x00ff99)

    _active.update(current.keys())

def send(message):
    """Send a plain Discord message (used for audit events)."""
    _discord(message, 0x00d4ff)

def _discord(content, color=0xff4444):
    if not config.DISCORD_WEBHOOK:
        return
    ts = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())
    payload = json.dumps({
        'embeds': [{'description': content, 'color': color,
                    'footer': {'text': f"Server Monitor • {ts}"}}]
    }).encode()
    try:
        req = urllib.request.Request(
            config.DISCORD_WEBHOOK, data=payload,
            headers={'Content-Type': 'application/json'}, method='POST')
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass
