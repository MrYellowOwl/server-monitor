import subprocess, os, signal, re
import config

_IP_RE = re.compile(r'^(\d{1,3}\.){3}\d{1,3}$')

def _valid_ip(ip):
    if not _IP_RE.match(ip):
        return False
    return all(0 <= int(p) <= 255 for p in ip.split('.'))

def _run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out = (r.stdout + r.stderr).strip()
        return {'success': r.returncode == 0, 'message': out or 'OK'}
    except subprocess.TimeoutExpired:
        return {'success': False, 'message': 'Command timed out'}
    except Exception as e:
        return {'success': False, 'message': str(e)}

def block_ip(ip):
    if not _valid_ip(ip):
        return {'success': False, 'message': 'Invalid IP address'}
    return _run(['ufw', 'deny', 'from', ip, 'to', 'any'])

def unblock_ip(ip):
    if not _valid_ip(ip):
        return {'success': False, 'message': 'Invalid IP address'}
    return _run(['ufw', 'delete', 'deny', 'from', ip, 'to', 'any'])

def kill_process(pid):
    try:
        pid = int(pid)
        if pid <= 1:
            return {'success': False, 'message': 'Refusing to kill PID <= 1'}
        os.kill(pid, signal.SIGTERM)
        return {'success': True, 'message': f'SIGTERM sent to PID {pid}'}
    except ProcessLookupError:
        return {'success': False, 'message': f'PID {pid} not found'}
    except PermissionError:
        return {'success': False, 'message': f'Permission denied for PID {pid}'}
    except Exception as e:
        return {'success': False, 'message': str(e)}

def control_service(service, action):
    allowed_actions  = {'start', 'stop', 'restart', 'reload'}
    allowed_services = set(config.SERVICES)
    if action not in allowed_actions:
        return {'success': False, 'message': f'Action must be one of: {", ".join(allowed_actions)}'}
    if service not in allowed_services:
        return {'success': False, 'message': f'Service "{service}" not in allowed list'}
    return _run(['systemctl', action, service])

def get_service_statuses():
    statuses = {}
    for svc in config.SERVICES:
        r = subprocess.run(['systemctl', 'is-active', svc],
                           capture_output=True, text=True, timeout=3)
        statuses[svc] = r.stdout.strip()
    return statuses

def get_service_journal(service, lines=80):
    if service not in set(config.SERVICES):
        return {'success': False, 'lines': [], 'message': 'Service not in allowed list'}
    r = subprocess.run(
        ['journalctl', '-u', service, '-n', str(min(int(lines), 200)),
         '--no-pager', '--output=short'],
        capture_output=True, text=True, timeout=8
    )
    return {'success': True, 'lines': [l for l in r.stdout.split('\n') if l.strip()]}

def fail2ban_unban(jail, ip):
    if not re.match(r'^[\w\-]+$', jail):
        return {'success': False, 'message': 'Invalid jail name'}
    if not _valid_ip(ip):
        return {'success': False, 'message': 'Invalid IP address'}
    return _run(['fail2ban-client', 'set', jail, 'unbanip', ip])

# ── Cron management ───────────────────────────────────────────────────────────

_CRON_SCHEDULE_RE = re.compile(
    r'^(\*|[\d,\-\*/]+)\s+(\*|[\d,\-\*/]+)\s+(\*|[\d,\-\*/]+)\s+(\*|[\d,\-\*/]+)\s+(\*|[\d,\-\*/]+)$'
)

def get_crontab():
    r = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
    entries = []
    for line in r.stdout.split('\n'):
        stripped = line.strip()
        if stripped and not stripped.startswith('#'):
            entries.append(stripped)
    return entries

def add_cron(schedule, command):
    schedule = schedule.strip()
    command  = command.strip()
    if not _CRON_SCHEDULE_RE.match(schedule):
        return {'success': False, 'message': 'Invalid cron schedule (need 5 time fields)'}
    if not command:
        return {'success': False, 'message': 'Command is required'}
    r = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
    current  = r.stdout if r.returncode == 0 else ''
    new_line = f"{schedule} {command}\n"
    r2 = subprocess.run(['crontab', '-'], input=current.rstrip('\n') + '\n' + new_line,
                        capture_output=True, text=True)
    return {'success': r2.returncode == 0, 'message': r2.stderr.strip() or 'Cron job added'}

def remove_cron(entry):
    entry = entry.strip()
    r = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
    lines    = r.stdout.split('\n')
    filtered = [l for l in lines if l.strip() != entry]
    if len(filtered) == len(lines):
        return {'success': False, 'message': 'Entry not found'}
    r2 = subprocess.run(['crontab', '-'], input='\n'.join(filtered),
                        capture_output=True, text=True)
    return {'success': r2.returncode == 0, 'message': r2.stderr.strip() or 'Cron job removed'}

# ── SSH key management ────────────────────────────────────────────────────────

_AUTH_KEYS = os.path.expanduser('~root/.ssh/authorized_keys')
_KEY_TYPES  = {'ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256',
               'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
               'sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com'}

def get_ssh_keys():
    if not os.path.exists(_AUTH_KEYS):
        return []
    keys = []
    with open(_AUTH_KEYS) as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue
            parts = stripped.split()
            keys.append({
                'type':    parts[0] if parts else '',
                'comment': parts[2] if len(parts) > 2 else '',
                'preview': parts[1][:32] + '…' if len(parts) > 1 else '',
                'raw':     stripped,
            })
    return keys

def add_ssh_key(key):
    key   = key.strip()
    parts = key.split()
    if not parts or parts[0] not in _KEY_TYPES:
        return {'success': False, 'message': f'Invalid key type. Expected one of: {", ".join(sorted(_KEY_TYPES))}'}
    if len(parts) < 2:
        return {'success': False, 'message': 'Key data missing'}
    os.makedirs(os.path.dirname(_AUTH_KEYS), exist_ok=True)
    with open(_AUTH_KEYS, 'a') as f:
        f.write(key + '\n')
    return {'success': True, 'message': 'SSH key added'}

def remove_ssh_key(raw):
    raw = raw.strip()
    if not os.path.exists(_AUTH_KEYS):
        return {'success': False, 'message': 'No authorized_keys file'}
    with open(_AUTH_KEYS) as f:
        lines = f.readlines()
    filtered = [l for l in lines if l.strip() != raw]
    if len(filtered) == len(lines):
        return {'success': False, 'message': 'Key not found'}
    with open(_AUTH_KEYS, 'w') as f:
        f.writelines(filtered)
    return {'success': True, 'message': 'SSH key removed'}

def get_log_tail(log_key, lines=150):
    path = config.LOG_PATHS.get(log_key)
    if not path or not os.path.exists(path):
        return []
    r = subprocess.run(['tail', '-n', str(min(int(lines), 500)), path],
                       capture_output=True, text=True, timeout=5)
    return r.stdout.split('\n')
