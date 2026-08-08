# 数据质量审计第 3 期（R295，只读）

审计时间：2026-08-08 04:05–04:40 UTC（北京时间 12:05–12:40）。
对象：生产库（服务器容器 recruit-postgres，库 recruit）。本期未改任何数据。
前期背景：R278 审计→R279 修复（板块归属，data_fix_audit run_tag=`r279_board_integrity`）；R283 审计→R284 修复（公共招聘网私企误标，run_tag=`r284_ncss_private`）。

## 结论速览

| # | 审计项 | 结论 |
|---|--------|------|
| 1 | R284 修复复核 | ✅ 软删 1027 行完整保留、无回流；白名单口径 639 行不变；存疑 445 行原样（6 家单位） |
| 2 | 近 7 天新增抽查 | ⚠️ 字段完整率高；板块归属正确，但 campus_jobs NCSS 源 company_type 自报失真（P2-1） |
| 3 | unified_jobs 对账 | ✅ 三板块与源表口径完全对上（校招差 1 行为 MV 刷新后新插入，属正常滞后） |
| 4 | 跨表重复 | ✅ R279 打标 1163 条稳定、无新增漏标；同名单位重叠 4810 行为社招 vs 校招不同岗位，同单位同岗位级重叠仅 ~54 行（含启发式误配） |
| 5 | 截止日期健康度 | ⚠️ 排序沉底逻辑正常；campus 198 行 2050 年代超远日期系源数据自带；bianzhi 中智源 2969 行截止日期全空（P2-2） |
| 6 | 每日任务趋势 | ⚠️ 采集与 enrich 填充率维持；worker 容器今日重启导致 7 天任务日志丢失，无法核成功率（P3-1）；positions 表 7/29 后零新增（属预期，见 6.3） |
| 7 | internal 流量标记 | ✅ R286 上线（8/7 18:55 UTC）后 metrics_request_log 120 条请求全部正确标 internal（均为 QA/爬虫 UA），真实口径干净但外部流量≈0 |

## 1. R284 修复效果复核

**1a. 软删行是否回流**：

```sql
SELECT count(*) FILTER (WHERE invalid_reason='r284_ncss_private') AS still_deleted,
       count(*) FILTER (WHERE invalid_reason='r284_ncss_private'
                        AND created_at > '2026-08-07 17:00+00') AS new_deleted
FROM positions;
-- still_deleted=1027, new_deleted=0
```

1027 行软删标记完整保留；`data_fix_audit` 中 run_tag=`r284_ncss_private` 恰 1027 条可回滚审计。软删行保留 content_hash（唯一索引），重复采集会撞唯一键，不会回流。近 10 天该源（exam_type LIKE '%中国公共招聘网%'）无任何新插入（最后一批 2026-07-29，2888 行），采集器 `scrape_mohrss_ggzp.py` 不在 celery beat 定时里（手动触发），白名单过滤（`classify_soe_name`，skip non-whitelisted）在生产**尚未经过一次真实采集验证**——下次运行该源时需复核 skipped 计数。

**1b. 白名单/存疑现状**（复跑 `scripts/fix_ncss_soe_r284.py` 干跑，只读）：

```
范围：1084 行 -> 保留 soe=639  软删 private=0  不动 unknown=445
```

与 R284 收尾状态一致：白名单 639 行保留、待软删 private=0（无新增误标）、存疑 445 行原样。存疑集中在 6 家单位：黑龙江省建设技术发展中心有限公司 ×28、新疆能源集团和田能源矿业 ×20、新疆亚新油气 ×18、马鞍山市中能节能材料 ×13、本溪九鼎铁刹旅游 ×13、深圳市亚鹰科技 ×1（此处样本行数与 445 总数为"行"与"单位聚合展示截断"关系，全部留待人工复核，本期不下结论）。

## 2. 近 7 天新增数据抽查

近 7 天新增：campus_jobs 24,183 行（NCSS 17,443/中智 3,001/国聘 3,519 为主）、bianzhi_jobs 8,291 行（国聘 5,320/中智 2,969）、positions 0 行。

**字段完整率（近 7 天新增，按源）**：

| 源（campus） | 行数 | deadline 填充 | industry 填充 | edu 填充 |
|---|---|---|---|---|
| NCSS | 17,443 | 0%（源不提供 deadline_text，与历史基线一致） | 87–91% | 100% |
| 中智 | 3,001 | 100% | 86–100% | 100% |
| 国聘 | 3,519 | 100% | 0%（历史基线亦 0%，源无该字段） | 80–100% |

bianzhi_jobs 近 7 天：iguopin 5,320 行 deadline 100%；**ciiczhaopin 2,969 行 deadline 0%**（见 5b/P2-2）。

**板块归属抽查（随机各 20 条，人工核）**：
- campus 20 条：均为校招/实习性质，announce_url 指向 job.ncss.cn / iguopin / ciiczhaopin 详情页，抽 4 条 URL 均 HTTP 200。板块归属无误。
- bianzhi 20 条：均为 央国企社招 类目，归属正确；其中 上海中智项目外包咨询服务有限公司（岗位外包）占 6/20，属源头岗位质量而非归属错误，暂记观察项。
- positions 近 7 天无新增，改抽 7/29 批次 20 条：公务员/事业编/军队文职/教师归属与 exam_type 一致，无误标。

**发现 P2-1**：campus_jobs NCSS 源 `company_type` 为单位自报，失真明显（抽样即见 私企标"机关/事业单位"、"央国企"）。量化（用 R284 同一套 `soe_name_rules.classify_soe_name` 只读复核）：

```
NCSS 且 company_type IN ('央国企','国有企业','中央企业')：11,735 行
-> soe=4,670  private=1,556  unknown=5,509
```

注意：该启发式对校招公司存在已知误报（如 北京北方华创微电子装备有限公司 实为国资控股上市公司但被判 private），**不建议照搬 R284 直接软删**；影响面是校招板块 company_type 筛选（央国企 筛选含水分），建议人工按单位聚合复核后再修（见修复建议）。

## 3. unified_jobs 与三表对账（invalid 排除口径）

```sql
-- unified_jobs：体制内 873,714 / 校招 43,001 / 编制 46,122
-- 源表同口径：
positions（dup_of_id IS NULL AND invalid_reason IS NULL AND job_type IN 8 类白名单）= 873,714 ✅
campus_jobs（invalid_reason IS NULL）= 43,002（差 1）
bianzhi_jobs（无排除口径）= 46,122 ✅
```

校招差 1 行 = id 66572（created_at 2026-08-08 03:50 UTC，晚于本次 MV 数据截面 03:00），属刷新滞后，下次 `refresh_unified_jobs` 自动纳入。**对账通过**。另确认 positions `其他企业` 1,123 行按设计不进 unified_jobs（8 类 job_type 白名单外）。

## 4. campus_jobs × bianzhi_jobs 跨表重复

- R279 打标 `campus_flag=true` 1,163 行与 data_fix_audit 记录一致；R279 口径（`employer LIKE '%校园招聘%'`）下**新增漏标 0 行**（近 7 天新增 8,291 行中 0 行命中）。
- 更宽的"同名单位"重叠：`lower(trim(employer))=lower(trim(company))` 且未打标 = **4,810 行 / 441 家单位**，全部为 8/1 后新增（中智/国聘 央国企社招 与同单位校招）。抽样看均为**社招岗 vs 校招岗**，非同岗位重复，不属 R279 校招公告口径。
- 同单位+岗位文本级重叠（bianzhi.job_type 出现在同单位 campus.positions 中）仅 **54 行**，且含"job_type='国企'"这类短词误配，真实同岗位重复量级更小。

结论：跨表重复无恶化；4,810 行同名单位重叠建议仅作前端"该单位另有校招"关联提示素材，不需数据修复。

## 5. 截止日期健康度

```sql
-- 表 | 总行 | 有截止 | 已截止 | >今天+365 | <2020
campus    | 43,002  | 10,854  | 4,262   | 198 | 1
bianzhi   | 46,122  | 32,469  | 26,363  | 7   | 0
positions | 874,837 | 321,655 | 311,746 | 1   | 0
```

- **沉底逻辑**：`/api/jobs` `deadline_asc` 排序对已截止行 CASE 沉底、`hide_expired` 过滤正常（jobs.py:131-137）；默认 `recommended` 按收录日期倒序，不做截止沉底（设计如此）。近 7 天新增且已截止：校招 179 / 编制 169 行（源头带旧截止日期入库，量小）。
- **5a 超远日期**：campus 198 行 >1 年，最远 2056-12-01；抽查 `deadline_text` 原文即为 2056/2053/2052（安岳安鼎鞋业、丹华船务等）——**源数据自带**（长期挂网岗），非解析错误。展示层若按"距截止 N 天"渲染会出现"剩 1 万+ 天"观感问题，建议展示层截断（P3-2）。
- **5b 发现 P2-2**：bianzhi_jobs 的中智源 2,969 行 `deadline_text`/`deadline_date` 全空——`enrich_ciic.py` 只回填 campus_jobs（中智），未覆盖 bianzhi_jobs 的 ciiczhaopin 行，导致该批永远无法参与截止排序/临期推送/过期沉底。
- 格式异常残留：<2020 的仅 campus 1 行，可忽略。

## 6. 每日任务近 7 天成功率与入库量

**6.1 任务成功率**：recruit-worker 容器于审计当日重启（Up 20 minutes），docker 日志随重启丢失，7 天窗口内仅见当日 4 个任务 succeeded、0 raised。**成功率无法从日志核实**（P3-1，建议任务结果落库）。以数据侧旁证：daily_digests 8/6、8/7 连续生成；enrich 审计文件按日生成于 exports/。

**6.2 入库量趋势（created_at 按日）**：

| 日期 | campus | bianzhi |
|---|---|---|
| 07-31 | 18,820（存量回填） | 37,831（存量回填） |
| 08-01 | 21 | 2 |
| 08-02 | 8 | 0 |
| 08-03 | 47 | 0 |
| 08-04 | 12,877 | 4,856 |
| 08-05 | 10,598 | 3,018 |
| 08-06 | 359 | 231 |
| 08-07 | 249 | 183 |
| 08-08* | 25 | 1 |

*8/8 为截至 04:05 UTC（当日采集批在北京时间 13:30 后）。8/2–8/3 接近零：处于采集器上线初期（8/4 起 NCSS/中智/国聘增量采集全量跑通），此后 8/6–8/7 回落至日增量稳态（数百/日），趋势正常。8/2–8/3 是否有静默失败因日志丢失无法定论，如实存疑。

**6.3 positions 7/29 后零新增**：positions 的源为批量导入（华图职位库/军队文职/公共招聘网等一次性脚本），不在每日 beat 定时内，7/29 后无批次属预期，不计异常。

**6.4 enrich 填充率维持**：见第 2 节表格，中智 deadline 100%、NCSS industry 87–91%，与上期基线持平。

## 7. R286 internal 流量标记效果

- `metrics_request_log`（R286 新增）自 2026-08-07 18:55 UTC 起记录，共 120 条，**internal=true 120 / false 0**；UA 全部为 QA/自动化特征（HeadlessChrome、`Devin/1.0`、测试机型 UA），标记准确，无真实用户被误标的反例（也无真实用户样本可验证反向误标）。
- `metrics_pv_daily`：8/7 external pv 22 条均为 R286 部署前时段；**8/8 全天（截至审计时点）pv 43 条 100% internal**，真实口径（internal=false）干净=0。
- 结论：R286 生效，QA 流量已从真实口径剥离；当前真实外部流量≈0，后续增长数据可信。

## P0–P3 问题清单

| 级别 | 编号 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| P2 | P2-1 | campus_jobs NCSS 源 company_type 自报失真：标 央国企/国有 的 11,735 行中启发式判 private 1,556 行、unknown 5,509 行（启发式对校招公司有误报，如北方华创） | 校招板块 company_type=央国企 筛选含水分 | 人工按单位聚合复核（先 top 单位），确认后参照 R284 软删/改标，勿直接批量套用启发式 |
| P2 | P2-2 | bianzhi_jobs 中智源 2,969 行 deadline 全空（enrich_ciic 只覆盖 campus_jobs） | 该批不参与截止排序/临期推送/过期沉底 | enrich_ciic 扩展到 bianzhi_jobs 的 ciiczhaopin 行（同一详情 API） |
| P3 | P3-1 | worker 容器重启即丢任务执行历史，成功率不可审计 | 运维可观测性 | 任务结果写库（如 task_runs 表）或日志持久化 |
| P3 | P3-2 | campus 198 行 2050 年代超远截止日期（源自带） | "剩余天数"类展示观感异常 | 展示层对 >365 天截断为"长期有效" |
| P3 | P3-3 | 公共招聘网源采集器不在定时任务内，R284 白名单过滤未经过一次生产采集验证 | 下次手动采集时需人工盯 | 下次运行时核对 skipped 计数与新入库行分类 |

## 存疑事项（如实列出，不下结论）

1. R284 的 445 行 unknown 单位（6 家）仍待人工复核，本期不改判。
2. 8/2–8/3 采集近零是上线初期正常空窗还是静默失败，因 worker 日志丢失无法定论。
3. metrics_request_log 仅 120 条样本，internal 标记的"漏标真实用户"方向暂无样本可验证。
4. bianzhi 央国企社招中岗位外包公司（上海中智项目外包等）大量刊登，是否符合板块定位属产品口径问题，交产品判断。
