# 上岸雷达 数据模型深度解读

> 版本：2026-07（R221）。覆盖三张业务主表、归一化管线、去重体系、来源映射、索引与缓存。
> 代码入口：`backend/models.py`（表定义）、`backend/ingest.py` + `backend/etl/normalize_v2.py`（体制内 ETL）、`backend/import_campus.py` / `import_bianzhi.py`（飞书源导入）、`backend/collect_iguopin.py` / `collect_ncss.py` / `collect_ciic.py`（增量采集器）、`backend/normalizer.py` + `backend/data_clean.py`（归一化/清洗）。

## 1. 总体架构

数据分三个业务板块，各对应一张规范表（canonical table）：

| 板块 | 表 | 规模（生产） | 内容 |
|---|---|---|---|
| 体制内 | `positions` | ~97.7 万 | 公务员/事业单位/军队文职/选调生等考录岗位 |
| 校招+社招 | `campus_jobs` | ~4.0 万 | 企业校园招聘 + 民营/外资社招（`batch=社招`） |
| 编制/央国企 | `bianzhi_jobs` | ~4.6 万 | 编制类公告 + 央国企社招（按 `category` 分类） |

所有来源（飞书多维表、国聘、NCSS、中智、公告页解析）都映射到这三张表；来源差异体现在字段填充率与部分枚举语义，不体现在表结构上。

数据流：

```
飞书 CSV 全量导入  ──┐
国聘 API 增量采集  ──┤→ 来源字段映射 → 清洗(data_clean) → 归一化(normalizer/normalize_v2)
NCSS API 增量采集 ──┤→ content_hash 去重 → upsert（非空新值才覆盖）→ 缓存失效
中智 API 增量采集  ──┘
公告页二次解析（字段补全，零覆盖原则：只填空字段）
```

## 2. positions（体制内主表）

每行 = 一个岗位（或一条岗位示例聚合）。三层字段：

**原始字段**（保留源文本）：`year`、`job_type`、`exam_type`、`employer`、`position_example`、`edu_requirement`、`undergrad_major`、`grad_major`、`college_major`、`raw_major`、`exam_form`、`signup_time`、`exam_time`、`special_requirements`、`work_location`、`source_url`、`notes`。

**归一化字段**（`ingest._enrich_record` 派生，原始值不丢）：
- `edu_level_norm`：`normalize_edu()` 五档枚举 —— 博士研究生 / 硕士研究生 / 本科 / 大专中专 / 其他不限；
- `job_type`：`normalize_job_type()` + `corporate_job_type()`（事业单位渠道混入的有限公司按 `_SOE_HINTS` 央企词表重分类为 央企/国企 或 其他企业）；
- `exam_type_norm`：`normalize_exam_type()`；若 job_type 被重分类为企业则强制 `企业招聘`；
- `province` / `city` / `district` + `location_tags`（ARRAY, GIN 索引）：`parse_location_tags()` 从 `work_location` 解析，pc.json 行政区划词表驱动，支持省→市→区县三级与直辖市特例；
- `signup_deadline`（DateTime，索引）：`parse_signup_deadline_v2()` 从 `signup_time` 文本解析；
- `search_text`：拼接岗位/单位/类型/专业/地点等字段，pg_trgm GIN 索引支撑中文子串搜索。

**去重与质量字段**：
- `content_hash`：全字段 MD5（含 source_url/notes），导入幂等键；
- `content_hash_v2`（`etl/normalize_v2.content_hash_v2`）：内容级 hash——去空白/全角括号归一后，只取 14 个内容字段（**排除 source_url 与 notes**），同一岗位换 URL 重抓时坍缩为一行；
- `dup_of_id`：跨行重复指向主行（查询过滤 `dup_of_id IS NULL`）；
- `invalid_reason`：垃圾/占位行标记（查询过滤 `IS NULL`）。

## 3. campus_jobs（校招+社招表）

每行 = 一家公司的一个招聘批次条目。关键字段语义：

- `source_table`：来源标识（校招汇总表 / 24-25届可投 / 央国企校招 / 免笔试汇总 / 内推码汇总 / 央国企事业单位名录 / 国聘 / NCSS / 中智）；
- `batch`：招聘批次（春招/秋招/暑期实习/**社招**——中智民营外资社招以 `batch=社招` 入本表）；
- `grad_years`：届次，导入时 `_norm_grad()` 把「26届」归一为「2026届」；
- `company_type` / `industry`：企业性质与行业（国聘/NCSS/中智源 industry 为空，源不提供）；
- `no_exam`：是否笔试/免笔试（仅飞书源有）；
- `deadline_text`（原文）与 `deadline_date`（解析后 Date，索引）双字段并存；
- `announce_url` / `apply_url`：公告与投递链接；`clean_announce_url()` 在已有官方投递链接时剔除第三方聚合站(offerleida)详情页；
- `content_hash`（unique）：`md5(source_table|company|positions|apply_url|announce_url|referral_code)` —— 同源幂等键；另有 `dedup_campus.py` 做跨源重复归并。

清洗规则（`data_clean.py`）：`clean_positions()` 剥离尾部第三方版权声明；`clean_major_requirement()` 清除运营口语占位（「…哦 宝宝~」）与句尾语气词。

## 4. bianzhi_jobs（编制/央国企表）

每行 = 一条招聘公告条目。`category` 是一级分类：公务员事业单位 / 教育系统 / 医疗系统 / 高校高职大专 / 科研院所 / **央国企社招**（含飞书源 + 国聘 + 中智央国企性质社招）/ 26年大型联考汇总。

字段与 campus_jobs 同构思路：单位（`employer`）、地点（`province` + `work_location`）、学历（`edu_requirement`）、专业（`major_requirement`）、时间（`deadline_text`/`deadline_date`/`signup_start`/`exam_time`）、链接（`announce_url`/`apply_url`）、`content_hash` unique 幂等。入库前 `is_bianzhi_junk_row()` 过滤导流行（含链接/「更多…信息」句式）与飞书占位行（「文本 N」）。

## 5. 三表命名差异对照（尚未物理统一）

| 概念 | positions | campus_jobs | bianzhi_jobs |
|---|---|---|---|
| 主体 | employer | company | employer |
| 地点 | work_location + province/city/district | locations | province + work_location |
| 学历 | edu_requirement + edu_level_norm | edu_requirement | edu_requirement |
| 专业 | undergrad_major/grad_major/raw_major | major_requirement | major_requirement |
| 截止 | signup_deadline(DateTime) | deadline_date(Date) | deadline_date(Date) |
| 类型 | job_type + exam_type_norm | company_type + batch | category + job_type |
| 原文 | source_url | announce_url/apply_url | announce_url/apply_url |

API 层（`crud.py`）对三表分别提供筛选，前端用统一筛选组件消化差异；物理统一（如 campus 重命名 recruit_jobs、字段对齐）属架构演进项，需评估迁移成本。

## 6. 来源 → 模型映射

- **飞书校招 base（5 表）**：`import_campus.TABLE_SPECS` 按文件名前缀映射中文列名 → 字段；全量幂等重跑。
- **飞书编制 base（9 表）**：`import_bianzhi.TABLE_SPECS` 同理，文件名前缀 → `category`。
- **国聘 iguopin**（`collect_iguopin.py`）：公开 JSON API；校招→campus_jobs（source_table=国聘），央国企社招→bianzhi_jobs（category=央国企社招）；每日 5:30 Celery 增量。
- **NCSS**（`collect_ncss.py`）：全国大学生就业服务平台公开接口→campus_jobs；每日 5:50。
- **中智 ciic**（`collect_ciic.py`）：`/api/position/search`；校招→campus_jobs；社招按 `qualitative` 分流——央国企/机关事业→bianzhi_jobs，民营/外资/合资→campus_jobs（batch=社招）；每日 6:10。
- **公告页二次解析**（R214 补全脚本）：对 positions 缺失的 signup_time/exam_time 等从 source_url 原文解析，**零覆盖**（只填空），JSONL 审计。

所有采集器共同约束：限速 ≥1s、UA 标注 `shangan-leida-collector; +https://jobs.zalize.com`、非空新值才覆盖、采集后 `cache.invalidate_prefixes()` 主动失效。

## 7. 辅助表

`sources`（体制内导入暂存/源表镜像）、`crawl_sources` + `announcements` + `crawl_runs` + `attachments`（公告采集流水线：来源配置→公告发现→运行记录→附件按 URL+SHA256 去重）、`feedback`（用户报错）、`link_checks`（每周死链扫描）、`push_subscriptions`（Web Push + 保存筛选快照）、`metrics_pv_daily` / `metrics_sessions_daily`（无 cookie 轻量统计）。

## 8. 索引与缓存

- positions：`search_text` gin_trgm（中文子串搜索）、`location_tags` GIN、year/job_type/edu_level_norm/exam_type_norm/province/city/signup_deadline B-tree；
- campus/bianzhi：筛选维度列全部 B-tree 索引，content_hash unique；
- Redis 缓存（`cache.py`）：`cached(prefix, ttl, stale=True)` 装饰器，STALE_TTL 7 天兜底，采集/导入后按前缀失效。

## 9. 已知缺口（R220 审计结论）

核心筛选字段（单位/地点/学历/批次/届次/公告链接）各主力源已 100% 同构。剩余缺口均为「源本身不提供」：

1. `industry`：国聘/NCSS/中智列表接口无 → 下轮采集器补映射或详情页解析；
2. `deadline_date`：NCSS/中智列表接口无 → 详情页二次解析试点（dry-run→抽查→apply）；
3. 体制内报名/考试时间：xduim（23.6 万）需换官方公告原链、华图需 xls 解析、zgsydw 源站无数据已止损；
4. 枚举语义（company_type/batch/exam_type 跨源写法）待进一步归一（保留原文+归一字段双轨，与 positions 的 `*_norm` 模式一致）。
