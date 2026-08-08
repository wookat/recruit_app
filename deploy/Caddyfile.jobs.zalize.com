# jobs.zalize.com 站点块（宿主机 /etc/caddy/Caddyfile 内的对应片段备份）
#
# 宿主机 Caddyfile 同时服务多个 zalize.com 子域，本仓库只备份 jobs.zalize.com
# 相关片段。修改宿主机配置后请同步更新本文件（反之亦然），并执行：
#   sudo caddy validate --config /etc/caddy/Caddyfile
#   sudo systemctl reload caddy
#
# access log：JSON 格式写 /var/log/caddy/jobs.zalize.com-access.log，
# 单文件 50MB 滚动，最多 10 个历史文件、保留 14 天（磁盘上限约 500MB，
# 宿主机磁盘已 88% 使用，勿放大）。用于 bot 抓取 / referer 可观测性分析。
#
# 保留窗口说明（R301 核查）：该 log 指令 2026-08-07 13:07 CST（R275）才
# 上线，此前无 access log——早于该时刻的数据不存在并非被误删。roll 由
# caddy 内建 lumberjack 管理；磁盘清理脚本（recruit-disk-maintenance.sh）
# 不触碰 /var/log/caddy，也没有针对它的 logrotate 规则（勿新增，会与
# caddy 自身 roll 冲突）。长期趋势由 tasks.aggregate_bot_crawl 每日
# 聚合到 bot_crawl_daily 表，不依赖日志窗口。

# recruit_app
jobs.zalize.com {
	log {
		output file /var/log/caddy/jobs.zalize.com-access.log {
			roll_size 50mb
			roll_keep 10
			roll_keep_for 336h
		}
		format json
	}
	reverse_proxy 127.0.0.1:8100 {
		lb_try_duration 20s
		lb_try_interval 500ms
	}
	encode gzip
}
