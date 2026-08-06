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

if [[ "$MODE" != "--frontend-only" ]]; then
  # SSR 模板变更需失效并重渲染 SEO 页缓存（26h TTL，启动预热不失效已有键）
  "${SSH[@]}" "sleep 15 && docker exec recruit-worker celery -A celery_app call tasks.warm_seo_pages" || \
    echo "WARN: SEO 缓存重预热任务下发失败，可手动执行 tasks.warm_seo_pages"
fi
echo "deployed: $(curl -s https://jobs.zalize.com/ | grep -o 'index-[^\"]*\.js' | head -1)"
