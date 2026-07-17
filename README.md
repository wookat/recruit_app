# 体制内岗位查询与抓取系统

一个用于搜索、筛选和抓取全国公务员、事业单位、国企央企等体制内岗位信息的 Web 应用。

## 技术栈

- **后端**：FastAPI + PostgreSQL + SQLAlchemy 2 + Pydantic v2 + Celery/Redis
- **前端**：React + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui + TanStack Table
- **抓取**：requests + ThreadPoolExecutor，针对中公事业单位职位系统（zw.zgsydw.com）实现全量分省/分学历/分城市抓取

## 主要功能

- 岗位搜索：按关键词、年份、工作类型、学历层级、专业、工作地点等筛选
- 省/市/区县三级地点筛选，支持多选
- 一键匹配：快速组合学历、专业、意向城市、目标类型
- 结果表格/卡片双视图，支持排序、分页、详情侧滑
- Celery 任务队列，可派发 2025/2026/2027 抓取任务
- 学历归一化：本科、硕士研究生、博士研究生、大专/中专、其他/不限
- 内容去重：基于 `content_hash` 的 MD5 去重

## 快速启动

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# 配置 PostgreSQL 与 Redis 后
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

数据库连接：修改 `backend/database.py` 中的 `SQLALCHEMY_DATABASE_URL`。

### 前端

```bash
cd frontend
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

### 抓取任务

```bash
cd backend
python scrape_zw_zgsydw.py --years 2026 --provinces 北京 上海
```

## 项目结构

```
recruit_app/
├── backend/          # FastAPI 后端与抓取脚本
│   ├── main.py       # API 入口
│   ├── crud.py       # 查询与过滤逻辑
│   ├── models.py     # SQLAlchemy 模型
│   ├── scrape_zw_zgsydw.py  # 事业单位全量抓取
│   └── ...
├── frontend/         # React 前端
│   ├── src/
│   └── dist/         # 生产构建（.gitignore 忽略）
└── README.md
```

## 数据来源

- 中公事业单位职位系统：http://zw.zgsydw.com/
- 国聘网央企/国企校招数据

## 许可证

MIT
