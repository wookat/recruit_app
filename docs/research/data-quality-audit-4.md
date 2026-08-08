# 数据质量审计第 4 期（R306，只读）

审计时间：2026-08-08 16:40–17:30 UTC（北京时间 8/9 00:40–01:30）。
对象：生产库（服务器容器 recruit-postgres，库 recruit）。本期未改任何数据。
前期背景：R295 审计→R296 修复（中智 bianzhi deadline 补全、NCSS company_type 人工复核重分类 11 行、task_runs 落库、公共招聘网白名单）；R305 展示层修复（长期有效阈值等）。

## 结论速览

| # | 审计项 | 结论 |
|---|--------|------|
| 1 | 跨表重复 | ⚠️ campus×bianzhi 无恶化（R279 1,163 稳定、新增漏标 0）；**新发现** positions×campus 国聘「2027国企校园招聘」批次跨板块双挂 ~741 组（P2-1） |
| 2 | 新鲜度 | ⚠️ 4 条采集源（NCSS/国聘/中智/飞书校招汇总表）活跃；飞书 5 张子表及 bianzhi 微信公众号源 7/31 后零新增（P2-2/P3-1）；positions 零新增属预期 |
| 3 | 字段完整性趋势 | ✅ 无回流恶化；ciiczhaopin deadline 0%→100%（R296 生效）；NCSS deadline 0% 为源限制维持 |
| 4 | unified 对账 | ✅ 体制内/编制精确一致；校招差 49 行全部为 MV 刷新（13:01 UTC）后新插入，属正常滞后；抽 20 行板块归属/链接/编码全部正常 |
| 5 | R296 复核 | ✅ 中智 deadline 2,969 行抽 15 条与源 API 100% 一致；NCSS 重分类 11 行稳定；r284 软删 1,027 行无回流 |
| 6 | 死链 | ⚠️ 抽样 162 条总体 200 率 90.7%；非 200 集中于 bianzhi 微信/政府源且 15/15 已截止（不在前端默认展示）；R246 机制在工作（8/8 03:55 有增量扫描），但 link_checks 不覆盖 positions.source_url（P3-2）；refresh_hot_cache 今日 3 次超时失败（P2-3） |

## 1. 跨表重复

**1a. campus×bianzhi（R279 口径复核）**：

```sql
SELECT count(*) FROM bianzhi_jobs WHERE campus_flag=true;                            -- 1163（与 R279 打标一致）
SELECT count(*) FROM bianzhi_jobs WHERE campus_flag=false AND employer LIKE '%校园招聘%';  -- 0（新增漏标 0）
```

- 同单位+同岗位名+同截止日（严格口径）：**0 行**。
- 同单位+岗位名（不含截止日，job_type≥4 字）：82 行，抽 8 组人工判读全部为**同名不同岗**（bianzhi 侧 job_type='国企' 等短词命中 campus 岗位名子串，如「国企纪检审计岗」；且截止日不同），无需处理。
- 同名单位重叠 4,821 行/442 家（R295 为 4,810/441），增量 11 行与日增节奏一致，性质不变（社招 vs 校招不同岗）。

**1b. positions×campus【新发现 P2-1】**：positions 表 7/29 导入过一批 `exam_type='2027国企校园招聘'` 共 **2,316 行**（job_type=央企/国企，在 unified 白名单内，2,316 行全部进 unified 体制内板块），来源与 campus_jobs 国聘源同一批国企校招岗：

```sql
-- 同单位+同岗位名（完全相等）+同截止日：3,423 行（多对多），去重后 positions 741 行 × campus 742 行
-- 再加工作地点完全相等：833 行
-- 2,316 行中与 campus 存在同单位+同岗位名重叠的：736 行（31.8%）
```

抽 10 组核验：联通各省分公司「客户策略管理」「5G网络优化工程师」等，单位/岗位名/截止日（2026-09-01）完全一致，仅工作地点为同一批岗位的不同网点拆行——**属同一招聘公告跨板块双挂**（体制内板块+校招板块同时出现）。用户在 unified「全部」视图会看到重复。量级 ~741 组（严格口径）至 2,316 行（整批）。

**1c. positions×bianzhi**：同单位+岗位名+截止日重叠 **0 行**；同名单位重叠 2,521 行（性质同 1a，不处理）。

## 2. 新鲜度（按 source）

**campus_jobs（有效行）**：

| source_table | 总行 | 近7天 | 近30天 | 最后新增 | 已截止 |
|---|---|---|---|---|---|
| NCSS | 17,515 | 17,515 | 17,515 | 08-08 | 0 |
| 24-25届可投（飞书） | 10,397 | 0 | 10,397 | 07-31 | 1,828 |
| 校招汇总表（飞书） | 5,903 | 221 | 5,903 | 08-07 | 1,664 |
| 国聘 | 3,519 | 3,519 | 3,519 | 08-07 | 139 |
| 中智 | 3,001 | 3,001 | 3,001 | 08-08 | 33 |
| 央国企校招（飞书） | 1,684 | 0 | 1,684 | 07-31 | 579 |
| 免笔试汇总（飞书） | 734 | 0 | 734 | 07-31 | 19 |
| 内推码汇总（飞书） | 249 | 0 | 249 | 07-31 | 0 |
| 央国企事业单位名录（飞书） | 72 | 0 | 72 | 07-31 | 0 |

**bianzhi_jobs（按 announce_url 域名）**：iguopin 5,321（日更，08-08）、ciiczhaopin 2,969（08-07）活跃；**mp.weixin.qq.com 9,631 行 7/31 后零新增且 55.8% 已截止**；南大/北京人社/广东人社等长尾政府源全部 7/31 存量导入后零新增。

**positions**：全部 21 个 exam_type_norm 最后新增 7/29（批量导入设计，零新增属预期，与 R295 6.3 结论一致）；有截止日行中已截止占比 96.9%（历史职位库属性，前端有 hide_expired/沉底逻辑，见 audit-3 第 5 节，本期不重复验证）。

**判读**：`refresh_feishu_data` 每日在跑且「校招汇总表」8/7 仍有 221 行新增，说明飞书同步链路本身活着；其余 5 张飞书子表零新增是**上游表格停更**（P3-1，需产品决定是继续维护还是标注存量）。mp.weixin 编制源 7/31 后零新增：该源为一次性导入（无对应采集器在 beat 里），过半已截止，属**事实死源**（P2-2）——编制板块的教育/医疗长尾正在老化，只剩国聘/中智两个央国企社招源在更新。

## 3. 字段完整性趋势（vs R295）

| 指标 | R295 | 本期 | 判定 |
|---|---|---|---|
| bianzhi ciiczhaopin deadline | 0%（2,969 行全空，P2-2） | **100%**（2,969/2,969） | ✅ R296 修复生效 |
| campus NCSS deadline | 0%（源不提供） | 0%（17,515 行） | 持平（源限制，非回归） |
| campus 国聘 deadline / 中智 deadline | 100% / 100% | 100% / 100% | ✅ 维持 |
| campus company_type 填充（NCSS/国聘/中智） | 100% | 100% | 维持（真实性问题见 R296 报告，仅 11 行已修，其余待工商数据源） |
| bianzhi province / edu | ~100% | 100% / 100% | ✅ 维持 |
| positions province / edu_level_norm | 100% / 100% | 100% / 100% | ✅ 维持 |
| positions signup_deadline | 36.8%（321,655） | 36.8%（321,655/874,837） | 持平（data_quality_audit 每日回填 5 万行上限已到可解析尽头） |

无任何字段空值率回流恶化。

## 4. unified_jobs 对账（截至 16:55 UTC）

```sql
-- unified：体制内 873,714 / 校招 43,025 / 编制 46,122
-- 源表同口径：positions（8 类白名单+非 dup+非 invalid）= 873,714 ✅
--   campus_jobs（invalid_reason IS NULL）= 43,074（差 49）
--   bianzhi_jobs = 46,122 ✅
SELECT count(*) FROM campus_jobs WHERE invalid_reason IS NULL
  AND created_at > (SELECT max(started_at) FROM task_runs
                    WHERE task_name='tasks.refresh_unified_jobs' AND status='success');  -- 49
```

校招差 49 行**全部**晚于最后一次成功 MV 刷新（08-08 13:01 UTC），属正常滞后，下次刷新自动纳入。**对账通过**。

抽 20 行人工核验：板块归属全部正确（体制内=公务员/事业编/军队文职等、校招=NCSS 详情页）；无乱码（employer/title 中文正常）；20 条 announce_url 全部 HTTP 200。

## 5. R296 修复复核

- **中智 bianzhi deadline**：随机抽 15 条，逐条请求 `https://www.ciiczhaopin.com/api/position/detail?uuid=…` 比对 `deadlineTime`，**15/15 与库内 deadline_text/deadline_date 完全一致**（含 2029 年远期值，为源数据自带）。
- **NCSS 重分类 11 行**：data_fix_audit run_tag=`r296_ncss_company_type` 11 条，逐行 JOIN campus_jobs 现值全部仍为「民营企业」，无被每日采集写回（MANUAL_PRIVATE_COMPANIES 覆写生效）。
- **软删回流**：positions `r284_ncss_private` 1,027 行完整保留、0 新增；campus_jobs 无 r 系 invalid（仅 junk 2 行）。

## 6. 死链抽样与 R246 机制

**抽样**（curl -L，UA 伪装，20s 超时；unified 20 + campus 50 + bianzhi 50 + positions 50 = 162 条含有效 URL）：

| 样本 | 200 | 非 200 |
|---|---|---|
| positions source_url ×50 | 50 | 0 |
| campus announce_url ×50 | 42 | 0（其余 8 条抽中行 announce_url 为空，见下） |
| bianzhi announce_url ×50 | 35 | 15（000×6、404×2、418×2、412/403/502 各 1…） |
| unified announce_url ×20 | 20 | 0 |

campus 抽样 50 条中 8 条 announce_url 为空（全部来自飞书「24-25届可投」）。量化：该表 4,476/10,397 行 announce_url 为空、内推码汇总 249/249 全空——多数有 apply_url 兜底，**announce_url 与 apply_url 双空的仅 274 行**（无任何入口链接，P3-4）。

bianzhi 非 200 的 15 条**全部**为 7/31 存量导入且 deadline 已过期的行（微信/地方政府源）——与第 2 节「编制长尾老化」同一问题，前端 hide_expired 下不外显，风险有限。

**R246 机制**：在工作。celery beat 有每周一全量（check_dead_links）+ 每日增量（check_dead_links_new，7:30）；link_checks 共 30,512 条 URL，最后写入 08-08 03:55 UTC，总 ok 率 88.3%（26,941/30,512）。两点缺口：
- 扫描范围只覆盖 campus.apply_url + bianzhi.apply_url/announce_url 的**未截止**行，positions.source_url（87 万行的入口链接）不在扫描范围（P3-2）；
- check_dead_links(_new) 未接入 task_runs 落库（task_runs 中 0 条 link 任务记录），成功率不可审计（P3-3）。

**顺带发现 P2-3**：task_runs 显示 `tasks.refresh_hot_cache` 今日 14:28–14:32 UTC 连续 3 次 `QueryCanceled: statement timeout` 失败。R303 已合并「后台预计算路径放宽 statement_timeout 至 120s」（commit 3ea0204），失败发生在合并之后，疑似**生产 worker 未重建镜像/未重启**或 120s 仍不够，需下轮核实部署版本并修复。

## P0–P3 问题清单

| 级别 | 编号 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| P2 | P2-1 | positions「2027国企校园招聘」批次 2,316 行与 campus 国聘源跨板块双挂（严格重复 ~741 组/833 行同地点） | unified 全部视图同一岗位出现两次 | 下轮修复：对该批 positions 行打 dup 标（或加 cross_board_dup 标记从 unified 白名单剔除），保留 campus 侧（字段更全）；参照 R279 写 data_fix_audit 可回滚 |
| P2 | P2-2 | bianzhi 微信公众号源 9,631 行（占编制板块 20.9%）7/31 后零新增、55.8% 已截止，为事实死源 | 编制板块教育/医疗长尾持续老化 | 产品决策：建 watch_sources/公众号采集器续接，或整批标注「存量归档」并在 UI 弱化 |
| P2 | P2-3 | refresh_hot_cache 8/8 连续 3 次 statement timeout 失败（R303 修复合并后仍发生） | stats/filters 热缓存可能长期陈旧 | 核实生产 worker 是否已跑最新镜像；仍失败则继续放宽超时或拆分查询 |
| P3 | P3-1 | 5 张飞书子表（24-25届可投/央国企校招/免笔试/内推码/名录，共 13,136 行）7/31 后上游停更 | 数据渐旧但同步链路本身正常 | 产品确认上游维护计划；停更超 60 天考虑标注收录截止时间 |
| P3 | P3-2 | link_checks 不覆盖 positions.source_url | 体制内板块入口链接死活无监控（本期抽样 50/50 全 200，暂无实害） | check_links 扩展 positions 未截止行的 source_url（去重后量级可控） |
| P3 | P3-3 | check_dead_links(_new) 未接入 task_runs | 死链任务成功率不可审计 | 给两个任务加 task_runs 落库装饰（与 R296 其他任务一致） |
| P3 | P3-4 | campus 274 行 announce_url/apply_url 双空（飞书源） | 用户点开无任何投递入口 | 下轮修复：软删或回源补链 |

## 存疑事项（如实列出，不下结论）

1. P2-1 的 2,316 行整批是否全部与 campus 重复（736 行有同名岗位匹配，其余可能因岗位名写法差异漏配），修复轮需先按公告 ID/URL 精确对齐再定剔除范围。
2. NCSS company_type 真实性问题（R295 P2-1）仍处「等工商数据源」状态，本期未重复量化。
