import hashlib, time, os, threading
from functools import wraps
from flask import Flask, render_template, request, session, jsonify, redirect
from modules import health, security, actions, history, webserver, alerts, audit
import config

app             = Flask(__name__)
app.secret_key  = config.SECRET_KEY
login_attempts  = {}   # ip -> [timestamps]

def _metrics_recorder():
    while True:
        time.sleep(60)
        try:
            h = health.get_all()
            history.record(h)
            alerts.check_and_notify(h)
        except Exception:
            pass

threading.Thread(target=_metrics_recorder, daemon=True).start()

# ── Auth helpers ──────────────────────────────────────────────────────────────

def require_auth(f):
    @wraps(f)
    def wrap(*args, **kwargs):
        if not session.get('ok'):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect('/')
        if time.time() - session.get('last_active', 0) > config.SESSION_TIMEOUT:
            session.clear()
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Session expired'}), 401
            return redirect('/?expired=1')
        session['last_active'] = time.time()
        return f(*args, **kwargs)
    return wrap

def _ip():
    return request.headers.get('X-Forwarded-For', request.remote_addr).split(',')[0].strip()

# ── Login / Logout ────────────────────────────────────────────────────────────

@app.route('/', methods=['GET', 'POST'])
def login():
    if session.get('ok'):
        return redirect('/dashboard')
    error = None
    if request.args.get('expired'):
        error = 'Session expired. Please log in again.'
    if request.method == 'POST':
        ip  = _ip()
        now = time.time()
        hits = [t for t in login_attempts.get(ip, []) if now - t < 300]
        if len(hits) >= 5:
            error = 'Too many attempts. Try again in 5 minutes.'
            audit.log('login_blocked', f'Too many attempts from {ip}', ip=ip, success=False)
        else:
            pw_hash = hashlib.sha256(request.form.get('password','').encode()).hexdigest()
            if pw_hash == config.PASSWORD_HASH:
                session['ok'] = True
                session['last_active'] = time.time()
                session.permanent = True
                login_attempts.pop(ip, None)
                audit.log('login', 'Successful login', ip=ip)
                return redirect('/dashboard')
            else:
                hits.append(now)
                login_attempts[ip] = hits
                error = 'Wrong password.'
                audit.log('login_failed', 'Bad password', ip=ip, success=False)
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    audit.log('logout', ip=_ip())
    session.clear()
    return redirect('/')

# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.route('/dashboard')
@require_auth
def dashboard():
    return render_template('index.html', default_password=config.DEFAULT_PASSWORD)

# ── API — Health ──────────────────────────────────────────────────────────────

@app.route('/api/health')
@require_auth
def api_health():
    return jsonify(health.get_all())

# ── API — Security ────────────────────────────────────────────────────────────

@app.route('/api/security')
@require_auth
def api_security():
    return jsonify(security.get_all())

@app.route('/api/ssl')
@require_auth
def api_ssl():
    domain = request.args.get('domain', config.DOMAIN)
    return jsonify(security.check_ssl(domain))

# ── API — Services ────────────────────────────────────────────────────────────

@app.route('/api/services')
@require_auth
def api_services():
    return jsonify(actions.get_service_statuses())

# ── API — Logs ────────────────────────────────────────────────────────────────

@app.route('/api/logs/<log_key>')
@require_auth
def api_logs(log_key):
    lines = request.args.get('lines', 150)
    return jsonify({'lines': actions.get_log_tail(log_key, lines)})

# ── API — History ─────────────────────────────────────────────────────────────

@app.route('/api/history')
@require_auth
def api_history():
    hours = request.args.get('hours', 1)
    return jsonify(history.get_history(hours))

# ── API — Audit log ───────────────────────────────────────────────────────────

@app.route('/api/audit')
@require_auth
def api_audit():
    return jsonify(audit.get_log())

# ── API — Journal ─────────────────────────────────────────────────────────────

@app.route('/api/journal/<service>')
@require_auth
def api_journal(service):
    return jsonify(actions.get_service_journal(service))

# ── API — Apps (Apache / MySQL / apt) ────────────────────────────────────────

@app.route('/api/apps')
@require_auth
def api_apps():
    return jsonify(webserver.get_all())

# ── API — Admin (cron / SSH keys) ─────────────────────────────────────────────

@app.route('/api/crontab')
@require_auth
def api_crontab():
    return jsonify(actions.get_crontab())

@app.route('/api/ssh-keys')
@require_auth
def api_ssh_keys():
    return jsonify(actions.get_ssh_keys())

@app.route('/api/certbot')
@require_auth
def api_certbot():
    return jsonify(actions.get_certbot_certs())

# ── API — Actions ─────────────────────────────────────────────────────────────

@app.route('/api/action', methods=['POST'])
@require_auth
def api_action():
    d      = request.get_json(force=True) or {}
    action = d.get('action')
    ip     = _ip()

    if action == 'block_ip':
        res = actions.block_ip(d.get('ip', ''))
        audit.log('block_ip', d.get('ip',''), ip=ip, success=res['success'])
        return jsonify(res)
    elif action == 'unblock_ip':
        res = actions.unblock_ip(d.get('ip', ''))
        audit.log('unblock_ip', d.get('ip',''), ip=ip, success=res['success'])
        return jsonify(res)
    elif action == 'kill_process':
        res = actions.kill_process(d.get('pid', 0))
        audit.log('kill_process', f"PID {d.get('pid')}", ip=ip, success=res['success'])
        return jsonify(res)
    elif action == 'service':
        res = actions.control_service(d.get('service',''), d.get('cmd',''))
        audit.log('service', f"{d.get('cmd')} {d.get('service')}", ip=ip, success=res['success'])
        if res['success']:
            alerts.send(f"🔧 Service **{d.get('service')}** → `{d.get('cmd')}`")
        return jsonify(res)
    elif action == 'fail2ban_unban':
        res = actions.fail2ban_unban(d.get('jail',''), d.get('ip',''))
        audit.log('fail2ban_unban', f"{d.get('ip')} from {d.get('jail')}", ip=ip, success=res['success'])
        if res['success']:
            alerts.send(f"🔓 Fail2ban unbanned **{d.get('ip')}** from jail `{d.get('jail')}`")
        return jsonify(res)
    elif action == 'add_cron':
        res = actions.add_cron(d.get('schedule',''), d.get('command',''))
        audit.log('add_cron', f"{d.get('schedule')} {d.get('command')}", ip=ip, success=res['success'])
        return jsonify(res)
    elif action == 'remove_cron':
        res = actions.remove_cron(d.get('entry',''))
        audit.log('remove_cron', d.get('entry',''), ip=ip, success=res['success'])
        return jsonify(res)
    elif action == 'add_ssh_key':
        res = actions.add_ssh_key(d.get('key',''))
        audit.log('add_ssh_key', d.get('key','')[:40] + '…', ip=ip, success=res['success'])
        if res['success']:
            alerts.send('🔑 SSH key added')
        return jsonify(res)
    elif action == 'remove_ssh_key':
        res = actions.remove_ssh_key(d.get('raw',''))
        audit.log('remove_ssh_key', d.get('raw','')[:40] + '…', ip=ip, success=res['success'])
        if res['success']:
            alerts.send('🗑️ SSH key removed')
        return jsonify(res)
    elif action == 'add_ufw_rule':
        res = actions.add_ufw_rule(d.get('act',''), d.get('port',''), d.get('proto','tcp'), d.get('from_ip','any'))
        audit.log('add_ufw_rule', f"{d.get('act')} {d.get('port')}/{d.get('proto')} from {d.get('from_ip','any')}", ip=ip, success=res['success'])
        return jsonify(res)
    elif action == 'delete_ufw_rule':
        res = actions.delete_ufw_rule(d.get('rule_num'))
        audit.log('delete_ufw_rule', f"rule #{d.get('rule_num')}", ip=ip, success=res['success'])
        return jsonify(res)
    elif action == 'ping':
        return jsonify(actions.ping_host(d.get('host', '')))
    elif action == 'renew_cert':
        res = actions.renew_cert(d.get('cert_name', ''))
        audit.log('renew_cert', d.get('cert_name',''), ip=ip, success=res['success'])
        return jsonify(res)
    return jsonify({'success': False, 'message': 'Unknown action'}), 400

# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(host=config.HOST, port=config.PORT, debug=False, threaded=True)
