import os, hashlib, secrets

PORT        = int(os.environ.get('SM_PORT', 6969))
HOST        = '0.0.0.0'
SECRET_KEY  = os.environ.get('SM_SECRET', secrets.token_hex(32))

# SHA-256 of the dashboard password. Default: 'admin' — change via SM_PASSWORD env var or edit directly.
_raw_pw       = os.environ.get('SM_PASSWORD', 'admin')
PASSWORD_HASH = hashlib.sha256(_raw_pw.encode()).hexdigest()

DOMAIN          = os.environ.get('SM_DOMAIN', '')
DISCORD_WEBHOOK  = os.environ.get('SM_DISCORD_WEBHOOK', '')
SESSION_TIMEOUT  = int(os.environ.get('SM_SESSION_HOURS', 8)) * 3600
DEFAULT_PASSWORD = (_raw_pw == 'admin')

ALERT_CPU  = int(os.environ.get('SM_ALERT_CPU',  90))
ALERT_MEM  = int(os.environ.get('SM_ALERT_MEM',  85))
ALERT_DISK = int(os.environ.get('SM_ALERT_DISK', 90))
ALERT_SWAP = int(os.environ.get('SM_ALERT_SWAP', 80))

LOG_PATHS = {
    'auth':              '/var/log/auth.log',
    'syslog':            '/var/log/syslog',
    'apache_access':     '/var/log/apache2/mryellowowl_access.log',
    'apache_error':      '/var/log/apache2/mryellowowl_error.log',
    'apache_monitor':    '/var/log/apache2/monitor_access.log',
    'kern':              '/var/log/kern.log',
}

SERVICES = [
    'apache2', 'mysql', 'mariadb', 'php8.3-fpm', 'php8.2-fpm',
    'php8.1-fpm', 'ssh', 'ufw', 'fail2ban', 'cron', 'nginx',
]
