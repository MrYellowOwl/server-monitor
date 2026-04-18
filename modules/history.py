import sqlite3, time, os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'metrics.db')
RETENTION_HOURS = 24

def _conn():
    con = sqlite3.connect(DB_PATH)
    con.execute('''CREATE TABLE IF NOT EXISTS metrics (
        ts       INTEGER PRIMARY KEY,
        cpu      REAL,
        mem      REAL,
        swap     REAL,
        net_sent INTEGER DEFAULT 0,
        net_recv INTEGER DEFAULT 0
    )''')
    for col in ('net_sent', 'net_recv'):
        try:
            con.execute(f'ALTER TABLE metrics ADD COLUMN {col} INTEGER DEFAULT 0')
        except Exception:
            pass
    con.commit()
    return con

def record(h):
    ts     = int(time.time() // 60) * 60
    cutoff = ts - RETENTION_HOURS * 3600
    net    = h.get('network', {})
    sent   = sum(v.get('bps_sent', 0) for v in net.values())
    recv   = sum(v.get('bps_recv', 0) for v in net.values())
    with _conn() as con:
        con.execute('INSERT OR REPLACE INTO metrics VALUES (?,?,?,?,?,?)',
                    (ts, h['cpu']['percent'], h['memory']['percent'],
                     h['memory']['swap_percent'], sent, recv))
        con.execute('DELETE FROM metrics WHERE ts < ?', (cutoff,))

def get_history(hours=1):
    cutoff = int(time.time()) - int(hours) * 3600
    with _conn() as con:
        rows = con.execute(
            'SELECT ts,cpu,mem,swap,net_sent,net_recv FROM metrics WHERE ts >= ? ORDER BY ts',
            (cutoff,)
        ).fetchall()
    return [{'ts': r[0], 'cpu': r[1], 'mem': r[2], 'swap': r[3],
             'net_sent': r[4] or 0, 'net_recv': r[5] or 0} for r in rows]
