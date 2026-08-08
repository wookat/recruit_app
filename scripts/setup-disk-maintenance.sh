#!/usr/bin/env bash
# 生产服务器磁盘运维一次性安装脚本（在服务器上以 root/sudo 执行）：
#   1. /etc/cron.d/recruit-disk-maintenance：每日 docker system prune + 磁盘水位告警日志
#   2. journald 磁盘上限（SystemMaxUse=500M）
# 用法（本地）：sshpass -e ssh ubuntu@<ip> 'sudo bash -s' < scripts/setup-disk-maintenance.sh
set -euo pipefail

# 1) 每日 docker prune（北京 04:10 = UTC 20:10，避开 05:30–08:00 采集窗）：
#    只清 72h 前的悬空/未使用镜像、停止容器、无用网络与构建缓存；在用镜像不受影响。
cat > /etc/cron.d/recruit-disk-maintenance <<'EOF'
# recruit_app 每日磁盘维护（安装/更新：scripts/setup-disk-maintenance.sh）
10 20 * * * root /usr/local/bin/recruit-disk-maintenance.sh >> /var/log/recruit-disk-maintenance.log 2>&1
EOF

cat > /usr/local/bin/recruit-disk-maintenance.sh <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
# 注意：本脚本不得触碰 /var/log/caddy/（Caddy access log 由 caddy 自身
# roll 管理：50MB×10、保留 14 天，是 bot 抓取观测数据源，勿删/勿轮转）。
echo "=== $(date -u '+%F %T UTC') disk maintenance ==="
docker system prune -af --filter "until=72h"
journalctl --vacuum-size=500M --vacuum-time=14d
USE=$(df --output=pcent / | tail -1 | tr -dc '0-9')
echo "root disk usage: ${USE}%"
if [ "${USE:-0}" -ge 90 ]; then
  echo "ALERT: root disk usage ${USE}% >= 90%, manual cleanup required" >&2
  logger -t recruit-disk "ALERT: root disk usage ${USE}% >= 90%"
fi
EOF
chmod +x /usr/local/bin/recruit-disk-maintenance.sh

# 2) journald 上限：500MB 封顶 + 14 天保留
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/size-limit.conf <<'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=14day
EOF
systemctl restart systemd-journald

# 日志文件自身滚动受控（logrotate）
cat > /etc/logrotate.d/recruit-disk-maintenance <<'EOF'
/var/log/recruit-disk-maintenance.log {
  monthly
  rotate 3
  compress
  missingok
  notifempty
}
EOF

echo "installed. current disk:"
df -h /
