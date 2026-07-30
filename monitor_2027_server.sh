#!/bin/bash
# 2027 体制内公告监控（服务器版）：每小时在 recruit-app 容器内运行
# watch_2027_announcements.py，发现新 .sql 导出后自动导入并增量 ETL。
set -eo pipefail

cd "${RECRUIT_APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
OUT_DIR="exports/2027_watch"
LOG="/var/log/monitor_2027.log"
FLAG="/var/run/monitor_2027_new_data"

echo "[$(date -Iseconds)] monitor started" >> "$LOG"
mkdir -p "$OUT_DIR"

while true; do
  echo "[$(date -Iseconds)] watching..." >> "$LOG"
  docker exec recruit-app python watch_2027_announcements.py --out "/app/$OUT_DIR" >> "$LOG" 2>&1 || true

  new_sql=()
  for sql in "$OUT_DIR"/*.sql; do
    if [ -f "$sql" ]; then
      if [ ! -f "$FLAG" ] || [ "$sql" -nt "$FLAG" ]; then
        new_sql+=("$sql")
      fi
    fi
  done

  if [ ${#new_sql[@]} -gt 0 ]; then
    echo "[$(date -Iseconds)] found ${#new_sql[@]} new SQL export(s)" >> "$LOG"
    max_id=$(docker exec recruit-postgres psql -U recruit -d recruit -Atc "SELECT COALESCE(MAX(id),0) FROM positions;")
    echo "[$(date -Iseconds)] current max id = $max_id" >> "$LOG"

    for sql in "${new_sql[@]}"; do
      echo "[$(date -Iseconds)] importing $sql" >> "$LOG"
      cat "$sql" | docker exec -i recruit-postgres psql -U recruit -d recruit >> "$LOG" 2>&1 || true
    done

    echo "[$(date -Iseconds)] normalizing new rows (id > $max_id)" >> "$LOG"
    docker exec recruit-app python etl/run_etl.py --steps normalize --where "id > $max_id" >> "$LOG" 2>&1 || true

    echo "[$(date -Iseconds)] rebuilding search_text for new rows" >> "$LOG"
    docker exec recruit-app python migrate_search_text_full.py --since-id "$max_id" >> "$LOG" 2>&1 || true

    echo "[$(date -Iseconds)] dedup + invalid check" >> "$LOG"
    docker exec recruit-app python etl/run_etl.py --steps dedupe,invalid >> "$LOG" 2>&1 || true

    echo "[$(date -Iseconds)] flushing redis cache" >> "$LOG"
    docker exec recruit-redis redis-cli FLUSHALL >> "$LOG" 2>&1 || true

    touch "$FLAG"
    echo "[$(date -Iseconds)] imported and refreshed. new max id: $(docker exec recruit-postgres psql -U recruit -d recruit -Atc "SELECT MAX(id) FROM positions;")" >> "$LOG"
  fi

  echo "[$(date -Iseconds)] sleeping 1 hour" >> "$LOG"
  sleep 3600
done
