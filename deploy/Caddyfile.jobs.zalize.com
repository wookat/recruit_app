# jobs.zalize.com 站点块（宿主机 /etc/caddy/Caddyfile 内的对应片段备份）
#
# 宿主机 Caddyfile 同时服务多个 zalize.com 子域，本仓库只备份 jobs.zalize.com
# 相关片段。修改宿主机配置后请同步更新本文件（反之亦然），并执行：
#   sudo caddy validate --config /etc/caddy/Caddyfile
#   sudo systemctl reload caddy
#
# access log：JSON 格式写 /var/log/caddy/jobs.zalize.com-access.log，
# 单文件 100MB 滚动，最多 10 个历史文件、保留 14 天（磁盘上限约 1GB）。
# 用于 bot 抓取 / referer 可观测性分析。

# recruit_app
jobs.zalize.com {
	log {
		output file /var/log/caddy/jobs.zalize.com-access.log {
			roll_size 100mb
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
