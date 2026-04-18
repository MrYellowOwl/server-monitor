#!/bin/bash
set -e

echo "=== Server Monitor Setup ==="

# Create virtualenv and install deps
python3 -m venv /opt/server-monitor/venv
/opt/server-monitor/venv/bin/pip install -q --upgrade pip
/opt/server-monitor/venv/bin/pip install -r /opt/server-monitor/requirements.txt

# Copy and enable systemd service
cp /opt/server-monitor/server-monitor.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable server-monitor
systemctl restart server-monitor

# Open port in UFW if active
if ufw status | grep -q "Status: active"; then
    ufw allow 6969/tcp comment "Server Monitor"
    echo "UFW: port 6969 opened."
fi

echo ""
echo "✓ Done! Dashboard running at http://$(hostname -I | awk '{print $1}'):6969"
echo ""
echo "  Default password: admin"
echo "  Change it: edit /etc/systemd/system/server-monitor.service"
echo "  Set SM_PASSWORD=yourpassword, then: systemctl daemon-reload && systemctl restart server-monitor"
