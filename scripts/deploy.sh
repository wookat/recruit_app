#!/usr/bin/env bash
# 部署到生产（jobs.zalize.com）。用法：
#   SERVER=ubuntu@<ip> SSHPASS=<密码> ./scripts/deploy.sh [--backend-only|--frontend-only]
# 要点：dist/assets 增量叠加（不 --delete），旧哈希 chunk 保留 7 天后清理，
# 避免部署窗口内浏览器拿到混版本 chunk（chunk 版本错配白屏）。
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER="${SERVER:?SERVER 未设置（如 ubuntu@1.2.3.4）}"

# 安全检查：禁止从不含 origin/main 的分支部署（防止旧分支覆盖主线，FORCE=1 可跳过）
git fetch origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  if [[ "${FORCE:-0}" == "1" ]]; then
    echo "WARN: 当前 HEAD 不包含 origin/main，FORCE=1 已指定，继续部署（请确认这是有意为之）"
  else
    echo "ERROR: 当前 HEAD 不包含 origin/main 的全部提交，部署会覆盖主线已上线代码。" >&2
    echo "  正确做法：合并 PR 后从最新 main 部署（git checkout main && git pull）。" >&2
    echo "  确需从该分支部署（明知会覆盖主线）：FORCE=1 SERVER=... ./scripts/deploy.sh" >&2
    exit 1
  fi
fi
# 从分支（非 main 顶点）部署时给出醒目提示（不阻断）
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "=============================================================="
  echo "WARN: 当前 HEAD != origin/main（分支部署）。"
  echo "  分支部署会覆盖其它未合并分支的已部署改动，合并后请从 main 重新部署。"
  echo "=============================================================="
fi
# 关键调度窗保护：北京时间 05:30–08:00 是每日采集/刷新任务密集期，
# 重启 worker 会造成 beat 定时任务漏发（启动补发可兜底，但仍应尽量避开）
BJ_HHMM=$(TZ=Asia/Shanghai date +%H%M)
if [[ "10#$BJ_HHMM" -ge 10#0530 && "10#$BJ_HHMM" -lt 10#0800 ]]; then
  if [[ "${ALLOW_SCHED_WINDOW:-0}" == "1" ]]; then
    echo "WARN: 当前处于关键调度窗（北京 05:30–08:00），ALLOW_SCHED_WINDOW=1 已指定，继续部署"
  else
    echo "ERROR: 当前北京时间 $BJ_HHMM 处于关键调度窗 05:30–08:00，重启 worker 可能漏发定时任务。" >&2
    echo "  请窗口外部署；确需现在部署：ALLOW_SCHED_WINDOW=1 SERVER=... ./scripts/deploy.sh" >&2
    exit 1
  fi
fi

REMOTE_DIR=/opt/recruit_app
SSH=(sshpass -e ssh -o StrictHostKeyChecking=no "$SERVER")
RSYNC=(sshpass -e rsync -az -e "ssh -o StrictHostKeyChecking=no")
MODE="${1:-all}"

if [[ "$MODE" != "--backend-only" ]]; then
  (cd frontend && npm run build)
  # assets 只增不删：旧版本 chunk 继续可用，index.html 等顶层文件覆盖
  "${RSYNC[@]}" frontend/dist/ "$SERVER:$REMOTE_DIR/frontend/dist/"
  # 清理 7 天前的旧哈希资源
  "${SSH[@]}" "find $REMOTE_DIR/frontend/dist/assets -type f -mtime +7 -delete 2>/dev/null || true"
fi

if [[ "$MODE" != "--frontend-only" ]]; then
  "${RSYNC[@]}" --delete backend/ "$SERVER:$REMOTE_DIR/backend/"
  "${RSYNC[@]}" docker-compose.prod.yml Dockerfile "$SERVER:$REMOTE_DIR/"
fi

"${SSH[@]}" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml build app && docker compose -f docker-compose.prod.yml up -d app worker worker-heavy"

if [[ "$MODE" != "--frontend-only" ]]; then
  # SSR 模板变更需失效并重渲染 SEO 页缓存（26h TTL，启动预热不失效已有键）
  "${SSH[@]}" "sleep 15 && docker exec recruit-worker celery -A celery_app call tasks.warm_seo_pages" || \
    echo "WARN: SEO 缓存重预热任务下发失败，可手动执行 tasks.warm_seo_pages"
fi
# 磁盘水位检查：>90% 打告警日志（每日维护脚本见 scripts/setup-disk-maintenance.sh）
DISK_USE=$("${SSH[@]}" "df --output=pcent / | tail -1 | tr -dc '0-9'" || echo "")
if [[ -n "$DISK_USE" && "$DISK_USE" -ge 90 ]]; then
  echo "ALERT: 服务器根分区磁盘使用率 ${DISK_USE}% >= 90%，请尽快清理（docker prune/日志/exports）" >&2
elif [[ -n "$DISK_USE" ]]; then
  echo "disk: 服务器根分区使用率 ${DISK_USE}%"
fi

echo "deployed: $(curl -s https://jobs.zalize.com/ | grep -o 'index-[^\"]*\.js' | head -1)"

# PWA 回归防护：/sw.js 必须是 Workbox 生成的 Service Worker（非 SPA HTML 兜底）
SW_HEAD=$(curl -s https://jobs.zalize.com/sw.js | head -c 300)
if echo "$SW_HEAD" | grep -q "precache\|workbox"; then
  echo "sw.js: OK (workbox service worker)"
else
  echo "ALERT: /sw.js 不是 Workbox Service Worker（PWA 离线能力可能失效），请检查 dist 构建产物与部署" >&2
fi
