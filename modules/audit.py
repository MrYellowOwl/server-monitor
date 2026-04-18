import sqlite3, time, os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'metrics.db')

def _conn():
    con = sqlite3.connect(DB_PATH)
    con.execute('''CREATE TABLE IF NOT EXISTS audit_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      INTEGER,
        action  TEXT,
        detail  TEXT,
        ip      TEXT,
        success INTEGER
    )''')
    con.commit()
    return con

def log(action, detail='', ip='', success=True):
    with _conn() as con:
        con.execute(
            'INSERT INTO audit_log (ts,action,detail,ip,success) VALUES (?,?,?,?,?)',
            (int(time.time()), action, detail, ip, int(success))
        )
        con.execute('DELETE FROM audit_log WHERE ts < ?', (int(time.time()) - 30 * 86400,))

def get_log(limit=200):
    with _conn() as con:
        rows = con.execute(
            'SELECT ts, action, detail, ip, success FROM audit_log ORDER BY ts DESC LIMIT ?',
            (limit,)
        ).fetchall()
    return [{'ts': r[0], 'action': r[1], 'detail': r[2], 'ip': r[3], 'success': bool(r[4])}
            for r in rows]
