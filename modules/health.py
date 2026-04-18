import psutil, os, time
from datetime import datetime, timedelta

_prev_net = {}
_prev_net_time = 0
_prev_disk = {}
_prev_disk_time = 0

def get_cpu():
    freq = psutil.cpu_freq()
    return {
        'percent':    psutil.cpu_percent(interval=0.2),
        'per_core':   psutil.cpu_percent(interval=0.2, percpu=True),
        'count':      psutil.cpu_count(logical=True),
        'phys_count': psutil.cpu_count(logical=False),
        'freq_mhz':   round(freq.current, 0) if freq else 0,
        'load_avg':   [round(x, 2) for x in os.getloadavg()],
    }

def get_memory():
    m = psutil.virtual_memory()
    s = psutil.swap_memory()
    return {
        'total':        m.total,
        'used':         m.used,
        'available':    m.available,
        'percent':      m.percent,
        'cached':       getattr(m, 'cached', 0),
        'buffers':      getattr(m, 'buffers', 0),
        'swap_total':   s.total,
        'swap_used':    s.used,
        'swap_percent': s.percent,
    }

def get_disks():
    disks = []
    for p in psutil.disk_partitions(all=False):
        if 'loop' in p.device:
            continue
        try:
            u = psutil.disk_usage(p.mountpoint)
            st = os.statvfs(p.mountpoint)
            ino_total = st.f_files
            ino_used  = ino_total - st.f_ffree
            ino_pct   = round(ino_used / ino_total * 100, 1) if ino_total else 0
            disks.append({
                'device':      p.device,
                'mountpoint':  p.mountpoint,
                'fstype':      p.fstype,
                'total':       u.total,
                'used':        u.used,
                'free':        u.free,
                'percent':     u.percent,
                'inode_total': ino_total,
                'inode_used':  ino_used,
                'inode_pct':   ino_pct,
            })
        except Exception:
            pass
    return disks

def get_network():
    global _prev_net, _prev_net_time
    now   = time.time()
    stats = psutil.net_io_counters(pernic=True)
    result = {}
    for iface, s in stats.items():
        if iface == 'lo':
            continue
        prev  = _prev_net.get(iface)
        dt    = now - _prev_net_time if _prev_net_time else 1
        bps_s = round((s.bytes_sent - prev.bytes_sent) / dt) if prev else 0
        bps_r = round((s.bytes_recv - prev.bytes_recv) / dt) if prev else 0
        result[iface] = {
            'bytes_sent':  s.bytes_sent,
            'bytes_recv':  s.bytes_recv,
            'bps_sent':    max(bps_s, 0),
            'bps_recv':    max(bps_r, 0),
            'packets_sent': s.packets_sent,
            'packets_recv': s.packets_recv,
            'errin':        s.errin,
            'errout':       s.errout,
        }
    _prev_net      = {k: v for k, v in stats.items()}
    _prev_net_time = now
    return result

def get_disk_io():
    global _prev_disk, _prev_disk_time
    now = time.time()
    try:
        counters = psutil.disk_io_counters(perdisk=True)
    except Exception:
        return {}
    result = {}
    for dev, s in counters.items():
        if 'loop' in dev:
            continue
        prev = _prev_disk.get(dev)
        dt   = now - _prev_disk_time if _prev_disk_time else 1
        bps_r = round((s.read_bytes  - prev.read_bytes)  / dt) if prev else 0
        bps_w = round((s.write_bytes - prev.write_bytes) / dt) if prev else 0
        result[dev] = {
            'read_bps':   max(bps_r, 0),
            'write_bps':  max(bps_w, 0),
            'read_bytes': s.read_bytes,
            'write_bytes':s.write_bytes,
        }
    _prev_disk      = {k: v for k, v in counters.items()}
    _prev_disk_time = now
    return result

def get_top_processes(n=20):
    procs = []
    for p in psutil.process_iter(['pid','name','username','status','memory_percent','create_time']):
        try:
            cpu = p.cpu_percent(interval=0)
            info = p.info
            info['cpu_percent'] = cpu
            info['cmdline']     = ' '.join(p.cmdline())[:80] if p.cmdline() else info['name']
            info['create_time'] = datetime.fromtimestamp(info['create_time']).strftime('%H:%M:%S')
            info['memory_percent'] = round(info['memory_percent'], 2)
            procs.append(info)
        except Exception:
            pass
    procs.sort(key=lambda x: x.get('cpu_percent', 0), reverse=True)
    return procs[:n]

def get_temps():
    result = {}
    try:
        temps = psutil.sensors_temperatures()
        for name, entries in (temps or {}).items():
            result[name] = [{'label': e.label or name,
                             'current': round(e.current, 1),
                             'high':     round(e.high, 1) if e.high else None,
                             'critical': round(e.critical, 1) if e.critical else None}
                            for e in entries]
    except Exception:
        pass
    return result

def get_uptime():
    bt  = psutil.boot_time()
    sec = int(time.time() - bt)
    return {
        'boot_time': datetime.fromtimestamp(bt).strftime('%Y-%m-%d %H:%M:%S'),
        'uptime':    str(timedelta(seconds=sec)),
        'seconds':   sec,
    }

def get_all():
    return {
        'cpu':       get_cpu(),
        'memory':    get_memory(),
        'disks':     get_disks(),
        'disk_io':   get_disk_io(),
        'network':   get_network(),
        'processes': get_top_processes(),
        'uptime':    get_uptime(),
        'temps':     get_temps(),
        'timestamp': time.time(),
    }
