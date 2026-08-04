#!/usr/bin/env bash
# 部署到生产（jobs.zalize.com）。用法：
#   SERVER=ubuntu@<ip> SSHPASS=<密码> ./scripts/deploy.sh [--backend-only|--frontend-only]
# 要点：dist/assets 增量叠加（不 --delete），旧哈希 chunk 保留 7 天后清理，
# 避免部署窗口内浏览器拿到混版本 chunk（chunk 版本错配白屏）。
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER="${SERVER:?SERVER 未设置（如 ubuntu@1.2.3.4）}"
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

"${SSH[@]}" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml build app && docker compose -f docker-compose.prod.yml up -d app worker"
echo "deployed: $(curl -s https://jobs.zalize.com/ | grep -o 'index-[^\"]*\.js' | head -1)"
