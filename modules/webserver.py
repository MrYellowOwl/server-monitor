import subprocess, json
import urllib.request

def get_apache_status():
    try:
        with urllib.request.urlopen('http://localhost/server-status?auto', timeout=3) as r:
            text = r.read().decode()
        data = {}
        for line in text.split('\n'):
            if ': ' in line:
                k, v = line.split(': ', 1)
                data[k.strip()] = v.strip()
        return {
            'available':     True,
            'total_accesses': int(float(data.get('Total Accesses', 0))),
            'req_per_sec':   float(data.get('ReqPerSec', 0)),
            'bytes_per_sec': float(data.get('BytesPerSec', 0)),
            'workers_busy':  int(data.get('BusyWorkers', 0)),
            'workers_idle':  int(data.get('IdleWorkers', 0)),
            'uptime_sec':    int(data.get('ServerUptimeSeconds', 0)),
        }
    except Exception:
        return {'available': False}

def get_mysql_status():
    try:
        r = subprocess.run(
            ['mysql', '--defaults-file=/etc/mysql/debian.cnf', '-BNe',
             "SHOW STATUS WHERE Variable_name IN ('Threads_connected','Slow_queries',"
             "'Questions','Max_used_connections','Aborted_connects');"],
            capture_output=True, text=True, timeout=5
        )
        data = {}
        for line in r.stdout.split('\n'):
            parts = line.split('\t')
            if len(parts) == 2:
                data[parts[0].strip()] = parts[1].strip()
        if not data:
            return {'available': False}
        return {
            'available':           True,
            'threads_connected':   int(data.get('Threads_connected', 0)),
            'slow_queries':        int(data.get('Slow_queries', 0)),
            'questions':           int(data.get('Questions', 0)),
            'max_used_connections':int(data.get('Max_used_connections', 0)),
            'aborted_connects':    int(data.get('Aborted_connects', 0)),
        }
    except Exception:
        return {'available': False}

def get_apt_updates():
    try:
        r = subprocess.run(
            ['apt', 'list', '--upgradable'],
            capture_output=True, text=True, timeout=20
        )
        packages = []
        for line in r.stdout.split('\n'):
            if '/' not in line:
                continue
            name = line.split('/')[0]
            is_security = 'security' in line.lower()
            packages.append({'name': name, 'security': is_security})
        return {
            'available':      True,
            'packages':       packages,
            'count':          len(packages),
            'security_count': sum(1 for p in packages if p['security']),
        }
    except Exception:
        return {'available': False, 'packages': [], 'count': 0, 'security_count': 0}

_ACCESS_RE = __import__('re').compile(r'(\S+) \S+ \S+ \[.*?\] "\S+ (\S+)[^"]*" (\d{3})')

def get_apache_log_stats(tail_lines=3000):
    log_path = '/var/log/apache2/mryellowowl_access.log'
    try:
        r = subprocess.run(['tail', '-n', str(tail_lines), log_path],
                           capture_output=True, text=True, timeout=8)
        ip_counts, url_counts, status_counts = {}, {}, {}
        for line in r.stdout.split('\n'):
            m = _ACCESS_RE.search(line)
            if not m:
                continue
            ip, url, status = m.groups()
            ip_counts[ip]       = ip_counts.get(ip, 0) + 1
            url_counts[url]     = url_counts.get(url, 0) + 1
            status_counts[status] = status_counts.get(status, 0) + 1
        total = sum(status_counts.values())
        if not total:
            return {'available': False}
        return {
            'available': True,
            'total':     total,
            'top_ips':   sorted(ip_counts.items(),  key=lambda x: x[1], reverse=True)[:10],
            'top_urls':  sorted(url_counts.items(), key=lambda x: x[1], reverse=True)[:10],
            's2xx': sum(v for k, v in status_counts.items() if k.startswith('2')),
            's4xx': sum(v for k, v in status_counts.items() if k.startswith('4')),
            's5xx': sum(v for k, v in status_counts.items() if k.startswith('5')),
        }
    except Exception:
        return {'available': False}

def get_all():
    return {
        'apache':     get_apache_status(),
        'mysql':      get_mysql_status(),
        'apt':        get_apt_updates(),
        'apache_log': get_apache_log_stats(),
    }
