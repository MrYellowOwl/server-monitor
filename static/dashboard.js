'use strict';

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt_bytes(b) {
    if (b < 1024)       return b + ' B';
    if (b < 1048576)    return (b/1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
    return (b/1073741824).toFixed(2) + ' GB';
}
function fmt_bps(b) {
    if (b < 1024)       return b + ' B/s';
    if (b < 1048576)    return (b/1024).toFixed(1) + ' KB/s';
    return (b/1048576).toFixed(1) + ' MB/s';
}
function pct_color(p) {
    if (p >= 90) return '#ff4444';
    if (p >= 70) return '#ff8c00';
    return '#00ff99';
}
function el(id) { return document.getElementById(id); }
function setText(id, v) { const e = el(id); if (e) e.textContent = v; }
function setHTML(id, v) { const e = el(id); if (e) e.innerHTML = v; }

async function api(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(r.status);
    return r.json();
}
async function post(path, data) {
    const r = await fetch(path, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
    });
    return r.json();
}

// ── Tab switching ─────────────────────────────────────────────────────────────

let activeTab = 'overview';
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        el('tab-' + activeTab).classList.remove('hidden');
        if (activeTab === 'history')   fetchHistory();
        if (activeTab === 'security')  fetchSecurity();
        if (activeTab === 'firewall')  fetchFirewall();
        if (activeTab === 'services')  fetchServices();
        if (activeTab === 'apps')      fetchApps();
        if (activeTab === 'admin')     fetchAdmin();
        if (activeTab === 'audit')     fetchAudit();
        if (activeTab === 'logs')      loadLog();
    });
});

// ── Alert system ─────────────────────────────────────────────────────────────

const THRESHOLDS = { cpu: 90, memory: 85, disk: 90, swap: 80 };
const _notified  = new Set(); // keys already browser-notified this session
let   _dismissed = false;

function checkAlerts(d) {
    const alerts = new Map();

    if (d.cpu.percent >= THRESHOLDS.cpu)
        alerts.set('cpu', `CPU at ${d.cpu.percent.toFixed(1)}%`);
    if (d.memory.percent >= THRESHOLDS.memory)
        alerts.set('mem', `Memory at ${d.memory.percent.toFixed(1)}%`);
    if (d.memory.swap_total > 0 && d.memory.swap_percent >= THRESHOLDS.swap)
        alerts.set('swap', `Swap at ${d.memory.swap_percent.toFixed(1)}%`);
    (d.disks || []).forEach(disk => {
        if (disk.percent >= THRESHOLDS.disk)
            alerts.set('disk:' + disk.mountpoint, `Disk ${disk.mountpoint} at ${disk.percent}%`);
    });

    // Browser notifications for newly-triggered alerts
    alerts.forEach((msg, key) => {
        if (!_notified.has(key)) {
            _notified.add(key);
            pushNotification('Server Alert', msg);
        }
    });
    // Clear notified set for alerts that resolved
    [..._notified].forEach(k => { if (!alerts.has(k)) _notified.delete(k); });

    if (alerts.size === 0) {
        el('alert-bar').classList.add('hidden');
        _dismissed = false;
        return;
    }
    if (_dismissed) return;
    let html = '';
    alerts.forEach(msg => { html += `<span class="alert-item">⚠ ${escHtml(msg)}</span>`; });
    setHTML('alert-items', html);
    el('alert-bar').classList.remove('hidden');
}

function dismissAlerts() {
    _dismissed = true;
    el('alert-bar').classList.add('hidden');
}

function pushNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        new Notification(title, {body, icon: '/static/favicon.ico'});
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// ── CPU history graph ─────────────────────────────────────────────────────────

const CPU_HISTORY = new Array(60).fill(0);

function drawCpuGraph(pct) {
    CPU_HISTORY.push(pct);
    if (CPU_HISTORY.length > 60) CPU_HISTORY.shift();

    const canvas = el('cpu-graph');
    if (!canvas) return;
    const W = canvas.offsetWidth || 700;
    const H = 80;
    canvas.width  = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    [25, 50, 75].forEach(y => {
        const py = H - (y / 100) * (H - 10) - 5;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '9px monospace';
        ctx.fillText(y + '%', 3, py - 2);
    });

    // Fill
    const step = W / (CPU_HISTORY.length - 1);
    ctx.beginPath();
    CPU_HISTORY.forEach((v, i) => {
        const x = i * step;
        const y = H - (v / 100) * (H - 10) - 5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo((CPU_HISTORY.length - 1) * step, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,255,153,0.08)';
    ctx.fill();

    // Line
    ctx.beginPath();
    CPU_HISTORY.forEach((v, i) => {
        const x = i * step;
        const y = H - (v / 100) * (H - 10) - 5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00ff99';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00ff99';
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawMiniBar(canvasId, pct) {
    const canvas = el(canvasId);
    if (!canvas) return;
    const W = canvas.offsetWidth || 200;
    canvas.width  = W * devicePixelRatio;
    canvas.height = 6 * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = pct_color(pct);
    ctx.fillRect(0, 0, (pct / 100) * W, 6);
}

// ── Health polling ────────────────────────────────────────────────────────────

async function fetchHealth() {
    try {
        const d = await api('/api/health');

        // Header
        setText('hdr-uptime', '↑ ' + d.uptime.uptime);
        el('hdr-pulse').title = 'Updated ' + new Date().toLocaleTimeString();
        setText('hdr-host', window.location.hostname);

        // CPU
        const cpu = d.cpu;
        setText('cpu-pct', cpu.percent.toFixed(1) + '%');
        setText('cpu-sub', cpu.count + ' cores · ' + cpu.freq_mhz + ' MHz · load ' + cpu.load_avg[0]);
        drawMiniBar('cpu-bar', cpu.percent);
        drawCpuGraph(cpu.percent);
        el('card-cpu').style.borderColor = cpu.percent > 80 ? '#ff4444' : '#1e1e1e';

        // Memory
        const mem = d.memory;
        setText('mem-pct', mem.percent.toFixed(1) + '%');
        setText('mem-sub', fmt_bytes(mem.used) + ' / ' + fmt_bytes(mem.total));
        drawMiniBar('mem-bar', mem.percent);
        el('card-mem').style.borderColor = mem.percent > 85 ? '#ff8c00' : '#1e1e1e';

        // Swap
        setText('swap-pct', mem.swap_percent.toFixed(1) + '%');
        setText('swap-sub', fmt_bytes(mem.swap_used) + ' / ' + fmt_bytes(mem.swap_total));
        drawMiniBar('swap-bar', mem.swap_percent);

        // Load
        setText('load-main', cpu.load_avg[0].toFixed(2));
        setText('load-sub', cpu.load_avg.join(' / ') + ' (1m/5m/15m)');

        // Disks
        let diskHtml = '';
        d.disks.forEach(disk => {
            const color   = pct_color(disk.percent);
            const inoColor = pct_color(disk.inode_pct || 0);
            diskHtml += `<div class="disk-item">
                <div class="disk-label">
                    <span><span class="c-cyan">${disk.device}</span> → ${disk.mountpoint} <span class="c-muted">(${disk.fstype})</span></span>
                    <span style="color:${color}">${disk.percent}%&nbsp; <span class="c-muted">${fmt_bytes(disk.used)} / ${fmt_bytes(disk.total)}</span></span>
                </div>
                <div class="disk-bar-bg"><div class="disk-bar-fg" style="width:${disk.percent}%;background:${color}"></div></div>
                ${disk.inode_pct != null ? `<div class="disk-inode">inodes ${disk.inode_pct}% used <span class="c-muted">(${(disk.inode_used/1000).toFixed(0)}k / ${(disk.inode_total/1000).toFixed(0)}k)</span></div>` : ''}
            </div>`;
        });
        setHTML('disk-list', diskHtml || '<span class="c-muted">No disks found.</span>');

        // Temperatures
        const temps = d.temps || {};
        const tempEntries = Object.entries(temps);
        if (tempEntries.length) {
            el('temps-panel').classList.remove('hidden');
            let tHtml = '';
            tempEntries.forEach(([sensor, readings]) => {
                readings.forEach(r => {
                    const color = r.critical && r.current >= r.critical ? 'c-red'
                                : r.high && r.current >= r.high ? 'c-yellow' : 'c-green';
                    tHtml += `<div class="temp-item">
                        <span class="temp-label">${escHtml(r.label || sensor)}</span>
                        <span class="${color} temp-val">${r.current}°C</span>
                        ${r.high ? `<span class="c-muted"> / high ${r.high}°C</span>` : ''}
                    </div>`;
                });
            });
            setHTML('temps-list', tHtml);
        } else {
            el('temps-panel').classList.add('hidden');
        }

        // Disk I/O
        let dioHtml = '';
        const diskIo = d.disk_io || {};
        Object.entries(diskIo).forEach(([dev, s]) => {
            dioHtml += `<div class="disk-io-item">
                <span class="disk-io-dev">${escHtml(dev)}</span>
                <div class="disk-io-stats">
                    <span>R <span class="disk-io-val">${fmt_bps(s.read_bps)}</span></span>
                    <span>W <span class="disk-io-val">${fmt_bps(s.write_bps)}</span></span>
                    <span class="c-muted">read ${fmt_bytes(s.read_bytes)} / written ${fmt_bytes(s.write_bytes)}</span>
                </div>
            </div>`;
        });
        setHTML('disk-io-list', dioHtml || '<span class="c-muted">No disk I/O data.</span>');

        // Network
        let netHtml = '';
        Object.entries(d.network).forEach(([iface, s]) => {
            netHtml += `<div class="net-item">
                <span class="net-iface">${iface}</span>
                <div class="net-stats">
                    <span>↑ <span class="net-val">${fmt_bps(s.bps_sent)}</span></span>
                    <span>↓ <span class="net-val">${fmt_bps(s.bps_recv)}</span></span>
                    <span class="c-muted">sent ${fmt_bytes(s.bytes_sent)} / recv ${fmt_bytes(s.bytes_recv)}</span>
                    ${s.errin + s.errout > 0 ? `<span class="c-red">err:${s.errin+s.errout}</span>` : ''}
                </div>
            </div>`;
        });
        setHTML('net-list', netHtml || '<span class="c-muted">No interfaces.</span>');

        // Processes (live)
        if (activeTab === 'processes') renderProcesses(d.processes);

        // Threshold alerts
        checkAlerts(d);

    } catch(e) {
        el('hdr-pulse').style.background = '#ff4444';
    }
}

// ── Processes ─────────────────────────────────────────────────────────────────

function renderProcesses(procs) {
    const filter = (el('proc-filter').value || '').toLowerCase();
    const filtered = filter
        ? procs.filter(p => p.name.toLowerCase().includes(filter) || p.cmdline.toLowerCase().includes(filter))
        : procs;
    let html = '';
    filtered.forEach(p => {
        const cpuColor = p.cpu_percent > 50 ? 'c-red' : p.cpu_percent > 20 ? 'c-yellow' : 'c-green';
        const memColor = p.memory_percent > 10 ? 'c-yellow' : '';
        html += `<tr>
            <td class="c-muted">${p.pid}</td>
            <td class="c-cyan">${escHtml(p.name)}</td>
            <td class="c-muted">${escHtml(p.username || '')}</td>
            <td class="${cpuColor}">${p.cpu_percent.toFixed(1)}%</td>
            <td class="${memColor}">${p.memory_percent.toFixed(1)}%</td>
            <td><span class="badge">${p.status}</span></td>
            <td class="c-muted">${p.create_time}</td>
            <td><button class="btn btn-sm btn-danger" onclick="confirmKill(${p.pid},'${escHtml(p.name)}')">Kill</button></td>
        </tr>`;
    });
    setHTML('proc-body', html || '<tr><td colspan="8" class="c-muted">No processes.</td></tr>');
}

el('proc-filter').addEventListener('input', () => { /* re-render on next tick */ });

// ── Security ──────────────────────────────────────────────────────────────────

async function fetchSecurity() {
    try {
        const d = await api('/api/security');

        // SSL
        const ssl = d.ssl;
        let sslHtml = '';
        if (ssl.valid) {
            const cls = ssl.days_left < 14 ? 'ssl-bad' : ssl.days_left < 30 ? 'ssl-warn' : 'ssl-ok';
            sslHtml = `<div class="ssl-row"><span>${ssl.domain}</span><span class="${cls}">✓ ${ssl.days_left} days left</span></div>
                       <div class="ssl-row c-muted"><span>Expires</span><span>${ssl.expires}</span></div>`;
        } else {
            sslHtml = `<div class="ssl-bad">✗ ${escHtml(ssl.error || 'Error checking certificate')}</div>`;
        }
        setHTML('ssl-info', sslHtml);

        // Active sessions
        let usersHtml = '';
        if (d.users.length === 0) {
            usersHtml = '<tr><td colspan="5" class="c-muted">No active sessions</td></tr>';
        } else {
            d.users.forEach(u => {
                const isSsh = u.from && u.from !== '-' && u.from !== ':0' && u.from !== '';
                usersHtml += `<tr>
                    <td class="${isSsh ? 'c-cyan' : 'c-green'}">${escHtml(u.user)}</td>
                    <td class="c-yellow">${escHtml(u.from || '—')}</td>
                    <td class="c-muted">${escHtml(u.login || '—')}</td>
                    <td class="c-muted">${escHtml(u.idle || '—')}</td>
                    <td class="c-muted">${escHtml(u.what || '—')}</td>
                </tr>`;
            });
        }
        setHTML('users-info', usersHtml);

        // Failed SSH
        const ssh = d.failed_ssh;
        setHTML('ssh-total', ssh.total + ' total failures');
        let ipsHtml = '';
        ssh.top_ips.forEach(([ip, count]) => {
            ipsHtml += `<div class="ip-row">
                <span class="ip-addr">${escHtml(ip)}</span>
                <div class="ip-actions">
                    <span class="ip-count">${count}×</span>
                    <button class="btn btn-sm btn-danger" onclick="confirmBlock('${escHtml(ip)}')">Block</button>
                </div>
            </div>`;
        });
        setHTML('ssh-ips', ipsHtml || '<span class="c-muted">No failures found.</span>');

        let linesHtml = ssh.recent_lines.slice(-40).reverse()
            .map(l => `<p class="${l.includes('Failed') || l.includes('Invalid') ? 'log-err' : ''}">${escHtml(l)}</p>`)
            .join('');
        setHTML('ssh-lines', linesHtml);

        // Ports
        let portsHtml = d.ports.map(p =>
            `<tr><td class="c-cyan">${escHtml(p.local)}</td><td class="c-yellow">${escHtml(p.port)}</td><td class="c-muted">${escHtml(p.process)}</td></tr>`
        ).join('');
        setHTML('ports-body', portsHtml || '<tr><td colspan="3" class="c-muted">None</td></tr>');

        // Connections
        const established = d.connections.filter(c => c.state === 'ESTAB');
        setHTML('conn-count', established.length + ' established');
        let connHtml = established.slice(0, 50).map(c =>
            `<tr><td><span class="badge-green">${c.state}</span></td><td class="c-muted">${escHtml(c.local)}</td><td class="c-cyan">${escHtml(c.remote)}</td><td class="c-muted">${escHtml(c.process)}</td></tr>`
        ).join('');
        setHTML('conn-body', connHtml || '<tr><td colspan="4" class="c-muted">None</td></tr>');

        // Last logins
        setHTML('last-logins', d.last_logins.map(l => `<p class="${l.startsWith('reboot') ? 'log-warn' : ''}">${escHtml(l)}</p>`).join(''));

        // Sudo
        setHTML('sudo-list', d.sudo.map(l => `<p class="log-warn">${escHtml(l)}</p>`).join('') || '<p class="c-muted">No recent sudo usage.</p>');

        // Fail2ban
        const f2b = d.fail2ban || {};
        if (!f2b.available) {
            setHTML('fail2ban-list', '<span class="c-muted">fail2ban not available.</span>');
        } else {
            let f2bHtml = '';
            (f2b.jails || []).forEach(jail => {
                f2bHtml += `<div class="f2b-jail">
                    <div class="f2b-header">
                        <span class="c-cyan">${escHtml(jail.name)}</span>
                        <span class="c-muted">failed: <span class="c-yellow">${jail.failed}</span>
                        &nbsp;banned: <span class="c-red">${jail.currently_banned}</span>
                        &nbsp;total: ${jail.total_banned}</span>
                    </div>`;
                if (jail.banned.length) {
                    jail.banned.forEach(ip => {
                        f2bHtml += `<div class="ip-row">
                            <span class="ip-addr">${escHtml(ip)}</span>
                            <button class="btn btn-sm btn-ok"
                                onclick="confirmAction('Unban <strong>${escHtml(ip)}</strong> from ${escHtml(jail.name)}?',
                                async()=>{ const r=await post('/api/action',{action:'fail2ban_unban',jail:'${escHtml(jail.name)}',ip:'${escHtml(ip)}'});
                                showResult('fail2ban-result',r); fetchSecurity(); })">Unban</button>
                        </div>`;
                    });
                } else {
                    f2bHtml += '<span class="c-muted" style="font-size:.75rem;padding-left:4px">No banned IPs</span>';
                }
                f2bHtml += '</div>';
            });
            setHTML('fail2ban-list', f2bHtml || '<span class="c-muted">No jails found.</span>');
        }

        // OOM events
        const oom = d.oom_events || [];
        if (oom.length) {
            el('oom-panel').classList.remove('hidden');
            setHTML('oom-list', oom.slice().reverse()
                .map(l => `<p class="log-err">${escHtml(l)}</p>`).join(''));
        } else {
            el('oom-panel').classList.add('hidden');
        }

        // WP Rate limits
        let rlHtml = '';
        if (d.wp_rate_limits && d.wp_rate_limits.length) {
            d.wp_rate_limits.forEach(r => {
                rlHtml += `<tr>
                    <td class="c-cyan">${escHtml(r.identifier)}</td>
                    <td class="c-muted">${escHtml(r.action)}</td>
                    <td class="${r.hits > 5 ? 'c-red' : 'c-yellow'}">${r.hits}</td>
                    <td class="c-muted">${escHtml(r.window_start)}</td>
                    <td><button class="btn btn-sm btn-danger" onclick="confirmBlock('${escHtml(r.identifier)}')">Block</button></td>
                </tr>`;
            });
        } else {
            rlHtml = '<tr><td colspan="5" class="c-muted">No rate-limited entries.</td></tr>';
        }
        setHTML('wp-rl-body', rlHtml);

    } catch(e) { console.error('Security fetch error:', e); }
}

// ── Firewall ──────────────────────────────────────────────────────────────────

async function fetchFirewall() {
    try {
        const d = await api('/api/security');
        const ufw = d.ufw;
        const badge = el('ufw-status-badge');
        badge.textContent = ufw.status;
        badge.className   = ufw.status === 'active' ? 'badge-green' : 'badge-red';
        setHTML('ufw-rules', ufw.rules.map(r => `<p>${escHtml(r)}</p>`).join('') || '<p class="c-muted">No rules found.</p>');
    } catch(e) {}
}

function blockIP() {
    const ip = el('fw-ip-input').value.trim();
    if (!ip) return;
    confirmAction(`Block IP <strong>${escHtml(ip)}</strong> via UFW?`, async () => {
        const res = await post('/api/action', {action:'block_ip', ip});
        showResult('fw-result', res);
        fetchFirewall();
    });
}
function unblockIP() {
    const ip = el('fw-ip-input').value.trim();
    if (!ip) return;
    confirmAction(`Unblock IP <strong>${escHtml(ip)}</strong>?`, async () => {
        const res = await post('/api/action', {action:'unblock_ip', ip});
        showResult('fw-result', res);
        fetchFirewall();
    });
}
function confirmBlock(ip) {
    el('fw-ip-input').value = ip;
    document.querySelector('[data-tab="firewall"]').click();
    setTimeout(() => blockIP(), 100);
}

// ── Services ──────────────────────────────────────────────────────────────────

async function fetchServices() {
    try {
        const d = await api('/api/services');
        let html = '';
        Object.entries(d).forEach(([svc, status]) => {
            const dotCls = status === 'active' ? 'svc-active' : status === 'inactive' ? 'svc-inactive' : 'svc-unknown';
            const color  = status === 'active' ? 'c-green' : status === 'inactive' ? 'c-red' : 'c-muted';
            html += `<tr>
                <td class="c-cyan">${escHtml(svc)}</td>
                <td><span class="svc-dot ${dotCls}"></span><span class="${color}">${status}</span></td>
                <td class="svc-actions">
                    <button class="btn btn-sm btn-ok"    onclick="svcAction('${svc}','start')">Start</button>
                    <button class="btn btn-sm"            onclick="svcAction('${svc}','restart')">Restart</button>
                    <button class="btn btn-sm btn-danger" onclick="svcAction('${svc}','stop')">Stop</button>
                    <button class="btn btn-sm"            onclick="openJournal('${svc}')">Logs</button>
                </td>
            </tr>`;
        });
        setHTML('svc-body', html);
    } catch(e) {}
}

function svcAction(svc, cmd) {
    confirmAction(`${cmd.toUpperCase()} service <strong>${escHtml(svc)}</strong>?`, async () => {
        const res = await post('/api/action', {action:'service', service:svc, cmd});
        showResult('svc-result', res);
        setTimeout(fetchServices, 1500);
    });
}

// ── Logs ─────────────────────────────────────────────────────────────────────

async function loadLog() {
    const key    = el('log-select').value;
    const filter = (el('log-filter').value || '').toLowerCase();
    try {
        const d = await api('/api/logs/' + key + '?lines=200');
        let lines = d.lines || [];
        if (filter) lines = lines.filter(l => l.toLowerCase().includes(filter));
        const html = lines.reverse().map(l => {
            const cls = /error|crit|emerg|fail/i.test(l) ? 'log-err'
                      : /warn/i.test(l)                  ? 'log-warn' : '';
            return `<p class="${cls}">${escHtml(l)}</p>`;
        }).join('');
        setHTML('log-content', html || '<p class="c-muted">No entries.</p>');
    } catch(e) { setHTML('log-content', '<p class="c-red">Failed to load log.</p>'); }
}

el('log-select').addEventListener('change', loadLog);
el('log-filter').addEventListener('input', () => {
    clearTimeout(el('log-filter')._t);
    el('log-filter')._t = setTimeout(loadLog, 300);
});

// ── Kill process ──────────────────────────────────────────────────────────────

function confirmKill(pid, name) {
    confirmAction(`Send SIGTERM to <strong>${escHtml(name)}</strong> (PID ${pid})?`, async () => {
        const res = await post('/api/action', {action:'kill_process', pid});
        alert(res.message);
    });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

let _modalCallback = null;
function confirmAction(msg, cb) {
    _modalCallback = cb;
    setHTML('modal-msg', msg);
    el('modal-overlay').classList.remove('hidden');
    el('modal-confirm').onclick = () => { closeModal(); cb(); };
}
function closeModal() {
    el('modal-overlay').classList.add('hidden');
    _modalCallback = null;
}
el('modal-overlay').addEventListener('click', e => { if (e.target === el('modal-overlay')) closeModal(); });

// ── Result helper ─────────────────────────────────────────────────────────────

function showResult(id, res) {
    const e = el(id);
    if (!e) return;
    e.textContent = res.message || (res.success ? 'Done.' : 'Error.');
    e.className   = 'action-result ' + (res.success ? 'ok' : 'err');
    setTimeout(() => { e.className = 'action-result'; e.textContent = ''; }, 4000);
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Apps tab ──────────────────────────────────────────────────────────────────

async function fetchApps() {
    try {
        const d = await api('/api/apps');

        // Apache
        const ap = d.apache;
        if (!ap.available) {
            setHTML('apache-info', '<span class="c-muted">Not available — enable mod_status at /server-status</span>');
        } else {
            setHTML('apache-info', `
                <div class="kv-row"><span class="c-muted">Requests/sec</span><span class="c-green">${ap.req_per_sec.toFixed(2)}</span></div>
                <div class="kv-row"><span class="c-muted">Throughput</span><span>${fmt_bps(ap.bytes_per_sec)}</span></div>
                <div class="kv-row"><span class="c-muted">Workers busy</span><span class="c-yellow">${ap.workers_busy}</span></div>
                <div class="kv-row"><span class="c-muted">Workers idle</span><span class="c-muted">${ap.workers_idle}</span></div>
                <div class="kv-row"><span class="c-muted">Total requests</span><span>${ap.total_accesses.toLocaleString()}</span></div>
            `);
        }

        // MySQL
        const my = d.mysql;
        if (!my.available) {
            setHTML('mysql-info', '<span class="c-muted">Not available — check /etc/mysql/debian.cnf</span>');
        } else {
            setHTML('mysql-info', `
                <div class="kv-row"><span class="c-muted">Connections</span><span class="c-cyan">${my.threads_connected}</span></div>
                <div class="kv-row"><span class="c-muted">Peak connections</span><span>${my.max_used_connections}</span></div>
                <div class="kv-row"><span class="c-muted">Total queries</span><span>${my.questions.toLocaleString()}</span></div>
                <div class="kv-row"><span class="c-muted">Slow queries</span><span class="${my.slow_queries > 0 ? 'c-yellow' : 'c-muted'}">${my.slow_queries}</span></div>
                <div class="kv-row"><span class="c-muted">Aborted connects</span><span class="${my.aborted_connects > 0 ? 'c-red' : 'c-muted'}">${my.aborted_connects}</span></div>
            `);
        }

        // Apt updates
        const apt = d.apt;
        if (!apt.available) {
            setHTML('apt-list', '<span class="c-muted">Could not check for updates.</span>');
            setText('apt-badge', '');
        } else if (apt.count === 0) {
            setHTML('apt-list', '<span class="c-green">System is up to date.</span>');
            setText('apt-badge', '');
        } else {
            const secBadge = apt.security_count > 0
                ? `<span class="badge-red">${apt.security_count} security</span> ` : '';
            el('apt-badge').innerHTML = secBadge + `<span class="badge">${apt.count} total</span>`;
            let html = apt.packages.map(p =>
                `<div class="apt-item ${p.security ? 'apt-security' : ''}">
                    <span class="${p.security ? 'c-red' : 'c-text'}">${escHtml(p.name)}</span>
                    ${p.security ? '<span class="badge-red" style="font-size:.65rem">security</span>' : ''}
                </div>`
            ).join('');
            setHTML('apt-list', html);
        }
        // Apache log analysis
        const al = d.apache_log;
        if (!al || !al.available) {
            el('apache-log-panel').classList.add('hidden');
        } else {
            el('apache-log-panel').classList.remove('hidden');
            const errPct = al.total ? ((al.s5xx / al.total) * 100).toFixed(1) : 0;
            setHTML('apache-log-info', `
                <div class="kv-row"><span class="c-muted">Requests analysed</span><span>${al.total.toLocaleString()}</span></div>
                <div class="kv-row"><span class="c-muted">2xx</span><span class="c-green">${al.s2xx.toLocaleString()}</span></div>
                <div class="kv-row"><span class="c-muted">4xx</span><span class="c-yellow">${al.s4xx.toLocaleString()}</span></div>
                <div class="kv-row"><span class="c-muted">5xx</span><span class="${al.s5xx > 0 ? 'c-red' : 'c-muted'}">${al.s5xx.toLocaleString()} (${errPct}%)</span></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">
                  <div>
                    <div class="sub-title">Top IPs</div>
                    ${al.top_ips.map(([ip,n]) => `<div class="ip-row">
                        <span class="ip-addr">${escHtml(ip)}</span>
                        <div class="ip-actions"><span class="ip-count">${n}</span>
                        <button class="btn btn-sm btn-danger" onclick="confirmBlock('${escHtml(ip)}')">Block</button></div>
                    </div>`).join('')}
                  </div>
                  <div>
                    <div class="sub-title">Top URLs</div>
                    ${al.top_urls.map(([url,n]) => `<div class="apt-item">
                        <span class="c-muted" style="flex:1;overflow:hidden;text-overflow:ellipsis">${escHtml(url)}</span>
                        <span class="c-cyan">${n}</span>
                    </div>`).join('')}
                  </div>
                </div>
            `);
        }
    } catch(e) { console.error('apps fetch error:', e); }
}

// ── Admin tab ─────────────────────────────────────────────────────────────────

async function fetchAdmin() {
    await Promise.all([fetchCrontab(), fetchSshKeys()]);
}

async function fetchCrontab() {
    try {
        const entries = await api('/api/crontab');
        let html = '';
        entries.forEach(entry => {
            const parts    = entry.split(/\s+/);
            const schedule = parts.slice(0, 5).join(' ');
            const command  = parts.slice(5).join(' ');
            html += `<tr>
                <td class="c-cyan" style="white-space:pre">${escHtml(schedule)}</td>
                <td class="c-muted">${escHtml(command)}</td>
                <td><button class="btn btn-sm btn-danger"
                    onclick="confirmAction('Remove this cron job?', async()=>{
                        const r=await post('/api/action',{action:'remove_cron',entry:${JSON.stringify(entry)}});
                        showResult('cron-result',r); fetchCrontab(); })">Remove</button></td>
            </tr>`;
        });
        setHTML('cron-body', html || '<tr><td colspan="3" class="c-muted">No cron jobs.</td></tr>');
    } catch(e) { console.error('crontab fetch error:', e); }
}

async function addCron() {
    const schedule = (el('cron-schedule').value || '').trim();
    const command  = (el('cron-command').value  || '').trim();
    if (!schedule || !command) return;
    const res = await post('/api/action', {action: 'add_cron', schedule, command});
    showResult('cron-result', res);
    if (res.success) { el('cron-schedule').value = ''; el('cron-command').value = ''; fetchCrontab(); }
}

async function fetchSshKeys() {
    try {
        const keys = await api('/api/ssh-keys');
        let html = '';
        keys.forEach(k => {
            html += `<tr>
                <td class="c-cyan">${escHtml(k.type)}</td>
                <td class="c-muted">${escHtml(k.comment || '—')}</td>
                <td class="c-muted" style="font-size:.7rem;font-family:monospace">${escHtml(k.preview)}</td>
                <td><button class="btn btn-sm btn-danger"
                    onclick="confirmAction('Remove SSH key <strong>${escHtml(k.comment || k.type)}</strong>?', async()=>{
                        const r=await post('/api/action',{action:'remove_ssh_key',raw:${JSON.stringify(k.raw)}});
                        showResult('ssh-key-result',r); fetchSshKeys(); })">Remove</button></td>
            </tr>`;
        });
        setHTML('ssh-keys-body', html || '<tr><td colspan="4" class="c-muted">No keys found.</td></tr>');
    } catch(e) { console.error('ssh keys fetch error:', e); }
}

async function addSshKey() {
    const key = (el('ssh-key-input').value || '').trim();
    if (!key) return;
    const res = await post('/api/action', {action: 'add_ssh_key', key});
    showResult('ssh-key-result', res);
    if (res.success) { el('ssh-key-input').value = ''; fetchSshKeys(); }
}

// Add result element for fail2ban (appended inline in Security tab)
document.querySelector('#tab-security').insertAdjacentHTML('beforeend',
    '<div id="fail2ban-result" class="action-result" style="padding:0 20px 10px"></div>');

// ── History charts ────────────────────────────────────────────────────────────

let _histHours = 1;

document.querySelectorAll('.hist-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.hist-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _histHours = parseInt(btn.dataset.h);
        fetchHistory();
    });
});

async function fetchHistory() {
    try {
        const rows = await api('/api/history?hours=' + _histHours);
        if (!rows.length) {
            setText('hist-hint', '(no data yet — recorded every 60 s)');
            return;
        }
        setText('hist-hint', rows.length + ' samples');
        drawHistChart('hist-cpu',  rows, r => r.cpu,  '#00ff99', 'CPU');
        drawHistChart('hist-mem',  rows, r => r.mem,  '#00d4ff', 'Mem');
        drawHistChart('hist-swap', rows, r => r.swap, '#ff8c00', 'Swap');
        drawHistNetChart('hist-net', rows);
    } catch(e) { console.error('history fetch error:', e); }
}

function drawHistChart(canvasId, rows, getter, color, label) {
    const canvas = el(canvasId);
    if (!canvas) return;
    const W  = canvas.offsetWidth || 700;
    const H  = 100;
    const PB = 18; // bottom padding for time axis
    canvas.width  = W * devicePixelRatio;
    canvas.height = (H + PB) * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H + PB);

    // Grid lines at 25/50/75/100
    [25, 50, 75, 100].forEach(y => {
        const py = H - (y / 100) * (H - 10) - 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '9px monospace';
        ctx.fillText(y + '%', 3, py - 2);
    });

    const vals = rows.map(getter);
    const step = W / Math.max(rows.length - 1, 1);

    // Fill
    ctx.beginPath();
    vals.forEach((v, i) => {
        const x = i * step;
        const y = H - (v / 100) * (H - 10) - 5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo((vals.length - 1) * step, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = color.replace(')', ', 0.08)').replace('rgb', 'rgba').replace('#', 'rgba(').replace('rgba(', 'rgba(');
    // simpler fill: use globalAlpha
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    // Line
    ctx.beginPath();
    vals.forEach((v, i) => {
        const x = i * step;
        const y = H - (v / 100) * (H - 10) - 5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Time axis: first and last timestamps
    if (rows.length >= 2) {
        const fmt = ts => new Date(ts * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px monospace';
        ctx.fillText(fmt(rows[0].ts), 4, H + PB - 4);
        const lastLabel = fmt(rows[rows.length - 1].ts);
        ctx.fillText(lastLabel, W - lastLabel.length * 5.5, H + PB - 4);
    }
}

function drawHistNetChart(canvasId, rows) {
    const canvas = el(canvasId);
    if (!canvas) return;
    const W  = canvas.offsetWidth || 700;
    const H  = 100;
    const PB = 18;
    canvas.width  = W * devicePixelRatio;
    canvas.height = (H + PB) * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H + PB);

    const maxVal = Math.max(1, ...rows.map(r => Math.max(r.net_sent || 0, r.net_recv || 0)));
    const step   = W / Math.max(rows.length - 1, 1);

    const drawLine = (getter, color) => {
        ctx.beginPath();
        rows.forEach((r, i) => {
            const x = i * step;
            const y = H - ((getter(r) / maxVal) * (H - 10)) - 5;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 3;
        ctx.stroke();
        ctx.shadowBlur = 0;
    };

    // Grid
    [25, 50, 75, 100].forEach(pct => {
        const py = H - (pct / 100) * (H - 10) - 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
        const label = fmt_bps(maxVal * pct / 100);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '9px monospace';
        ctx.fillText(label, 3, py - 2);
    });

    drawLine(r => r.net_sent || 0, '#00ff99');
    drawLine(r => r.net_recv || 0, '#00d4ff');

    if (rows.length >= 2) {
        const fmt = ts => new Date(ts * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px monospace';
        ctx.fillText(fmt(rows[0].ts), 4, H + PB - 4);
        const lastLabel = fmt(rows[rows.length - 1].ts);
        ctx.fillText(lastLabel, W - lastLabel.length * 5.5, H + PB - 4);
    }
}

// ── Audit log ─────────────────────────────────────────────────────────────────

async function fetchAudit() {
    try {
        const rows = await api('/api/audit');
        if (!rows.length) {
            setHTML('audit-body', '<tr><td colspan="5" class="c-muted">No audit entries yet.</td></tr>');
            return;
        }
        const html = rows.map(r => {
            const t   = new Date(r.ts * 1000).toLocaleString();
            const cls = r.success ? 'c-green' : 'c-red';
            return `<tr>
                <td class="c-muted" style="white-space:nowrap">${escHtml(t)}</td>
                <td class="c-cyan">${escHtml(r.action)}</td>
                <td class="c-muted">${escHtml(r.detail || '—')}</td>
                <td class="c-muted">${escHtml(r.ip || '—')}</td>
                <td class="${cls}">${r.success ? '✓ ok' : '✗ fail'}</td>
            </tr>`;
        }).join('');
        setHTML('audit-body', html);
    } catch(e) { console.error('audit fetch error:', e); }
}

// ── Service journal ───────────────────────────────────────────────────────────

let _journalSvc = '';

async function openJournal(svc) {
    _journalSvc = svc;
    setText('journal-svc-name', svc);
    el('journal-panel').classList.remove('hidden');
    el('journal-panel').scrollIntoView({behavior: 'smooth', block: 'start'});
    await refreshJournal();
}

async function refreshJournal() {
    if (!_journalSvc) return;
    setHTML('journal-content', '<p class="c-muted">Loading…</p>');
    try {
        const d = await api('/api/journal/' + encodeURIComponent(_journalSvc));
        const html = (d.lines || []).reverse().map(l => {
            const cls = /error|crit|emerg|fail/i.test(l) ? 'log-err'
                      : /warn/i.test(l)                  ? 'log-warn' : '';
            return `<p class="${cls}">${escHtml(l)}</p>`;
        }).join('');
        setHTML('journal-content', html || '<p class="c-muted">No entries.</p>');
    } catch(e) {
        setHTML('journal-content', '<p class="c-red">Failed to load journal.</p>');
    }
}

function closeJournal() {
    el('journal-panel').classList.add('hidden');
    _journalSvc = '';
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

fetchHealth();
setInterval(fetchHealth, 3000);
setInterval(() => { if (activeTab === 'security') fetchSecurity(); }, 15000);
setInterval(() => { if (activeTab === 'services') fetchServices(); }, 8000);
