import subprocess, re, os, ssl, socket
from datetime import datetime
import config

_IP_RE = re.compile(r'\b(\d{1,3}(?:\.\d{1,3}){3})\b')

def _run(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout
    except Exception:
        return ''

def get_failed_ssh(limit=200):
    out   = _run(['grep', '-hiE', 'Failed|Invalid|authentication failure',
                  '/var/log/auth.log', '/var/log/auth.log.1'], timeout=8)
    lines = [l for l in out.split('\n') if l.strip()]
    ip_counts = {}
    for line in lines:
        for ip in _IP_RE.findall(line):
            ip_counts[ip] = ip_counts.get(ip, 0) + 1
    top_ips = sorted(ip_counts.items(), key=lambda x: x[1], reverse=True)[:25]
    return {
        'recent_lines': lines[-limit:],
        'top_ips':      top_ips,
        'total':        len(lines),
    }

def get_active_connections():
    out   = _run(['ss', '-tnp'])
    conns = []
    for line in out.split('\n')[1:]:
        parts = line.split()
        if len(parts) >= 5:
            conns.append({
                'state':   parts[0],
                'local':   parts[3],
                'remote':  parts[4],
                'process': parts[5] if len(parts) > 5 else '',
            })
    return conns

def get_listening_ports():
    out   = _run(['ss', '-tlnp'])
    ports = []
    for line in out.split('\n')[1:]:
        parts = line.split()
        if len(parts) >= 4:
            ports.append({
                'local':   parts[3],
                'port':    parts[3].rsplit(':', 1)[-1],
                'process': parts[5] if len(parts) > 5 else '',
            })
    return ports

def get_logged_in_users():
    out   = _run(['w', '-h'])
    users = []
    for line in out.split('\n'):
        p = line.split()
        if len(p) < 4:
            continue
        # When TTY is blank (common for SSH on some systems), FROM shifts to p[1]
        if p[1].startswith('pts') or p[1].startswith('tty') or p[1] == '?':
            user, src, login, idle = p[0], p[2] if len(p) > 2 else '', p[3] if len(p) > 3 else '', p[4] if len(p) > 4 else ''
            what = ' '.join(p[7:]) if len(p) > 7 else ''
        else:
            user, src, login, idle = p[0], p[1], p[2], p[3]
            what = ' '.join(p[6:]) if len(p) > 6 else ''
        users.append({'user': user, 'from': src, 'login': login, 'idle': idle, 'what': what})
    return users

def get_ufw_rules():
    out   = _run(['ufw', 'status', 'numbered'])
    rules = []
    for line in out.split('\n'):
        if re.match(r'\s*\[\s*\d+\]', line):
            rules.append(line.strip())
    status = 'active' if 'Status: active' in out else 'inactive'
    return {'status': status, 'rules': rules, 'raw': out}

def get_sudo_recent(limit=30):
    out   = _run(['grep', '-i', 'sudo', '/var/log/auth.log'])
    lines = [l for l in out.split('\n') if l.strip()]
    return lines[-limit:]

def get_last_logins(limit=20):
    out = _run(['last', '-n', str(limit), '-F'])
    return [l for l in out.split('\n') if l.strip() and 'wtmp begins' not in l]

def get_cron_jobs():
    jobs = []
    for d in ['/etc/cron.d', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly', '/etc/cron.hourly']:
        if os.path.isdir(d):
            for f in os.listdir(d):
                jobs.append({'source': d, 'name': f})
    out = _run(['crontab', '-l'])
    for line in out.split('\n'):
        if line.strip() and not line.startswith('#'):
            jobs.append({'source': 'root crontab', 'name': line.strip()})
    return jobs

def check_ssl(domain=None):
    domain = domain or config.DOMAIN
    if not domain:
        return {'domain': '', 'error': 'SM_DOMAIN not configured', 'valid': False, 'days_left': -1}
    try:
        ctx = ssl.create_default_context()
        with ctx.wrap_socket(socket.socket(), server_hostname=domain) as s:
            s.settimeout(5)
            s.connect((domain, 443))
            cert      = s.getpeercert()
            expires   = datetime.strptime(cert['notAfter'], '%b %d %H:%M:%S %Y %Z')
            days_left = (expires - datetime.utcnow()).days
            return {'domain': domain, 'expires': str(expires), 'days_left': days_left, 'valid': True}
    except Exception as e:
        return {'domain': domain, 'error': str(e), 'valid': False, 'days_left': -1}

def get_recent_wp_failures(limit=50):
    """Read rate-limit data from a WordPress site. Requires SM_WP_PATH env var pointing to the WP root."""
    import os, json
    wp_path = os.environ.get('SM_WP_PATH', '')
    if not wp_path:
        return []
    try:
        result = subprocess.run(
            ['php', '-r',
             f"require '{wp_path}/wp-load.php';"
             "global $wpdb;"
             "$rows = $wpdb->get_results(\"SELECT identifier,action,hits,window_start FROM {$wpdb->prefix}ctf_rate_limits ORDER BY hits DESC LIMIT 50\", ARRAY_A);"
             "echo json_encode($rows);"],
            capture_output=True, text=True, timeout=10
        )
        return json.loads(result.stdout) if result.stdout else []
    except Exception:
        return []

def get_oom_events(limit=30):
    out = _run(['grep', '-iE', 'Out of memory|oom.{0,30}kill|Kill process',
                '/var/log/kern.log'], timeout=8)
    lines = [l for l in out.split('\n') if l.strip()]
    return lines[-limit:]

def get_fail2ban():
    out = _run(['fail2ban-client', 'status'], timeout=5)
    if not out or 'Jail list' not in out:
        return {'available': False, 'jails': []}
    jails = []
    for line in out.split('\n'):
        if 'Jail list:' in line:
            jails = [j.strip() for j in line.split(':', 1)[1].split(',') if j.strip()]
    result = {'available': True, 'jails': []}
    for jail in jails:
        j_out = _run(['fail2ban-client', 'status', jail], timeout=5)
        info  = {'name': jail, 'banned': [], 'currently_banned': 0, 'total_banned': 0, 'failed': 0}
        for line in j_out.split('\n'):
            if 'Currently banned' in line:
                try: info['currently_banned'] = int(line.split(':', 1)[1].strip())
                except: pass
            elif 'Total banned' in line:
                try: info['total_banned'] = int(line.split(':', 1)[1].strip())
                except: pass
            elif 'Currently failed' in line:
                try: info['failed'] = int(line.split(':', 1)[1].strip())
                except: pass
            elif 'Banned IP list' in line:
                raw = line.split(':', 1)[1].strip() if ':' in line else ''
                info['banned'] = [ip for ip in raw.split() if ip]
        result['jails'].append(info)
    return result

def get_all():
    return {
        'failed_ssh':      get_failed_ssh(),
        'connections':     get_active_connections(),
        'ports':           get_listening_ports(),
        'users':           get_logged_in_users(),
        'ufw':             get_ufw_rules(),
        'sudo':            get_sudo_recent(),
        'last_logins':     get_last_logins(),
        'cron':            get_cron_jobs(),
        'ssl':             check_ssl(),
        'wp_rate_limits':  get_recent_wp_failures(),
        'fail2ban':        get_fail2ban(),
        'oom_events':      get_oom_events(),
    }
