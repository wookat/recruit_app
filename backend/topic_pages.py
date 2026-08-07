"""热门筛选组合专题页（/topic）的候选组合与口径。

专题从站内数据自动生成（R266，R257 竞品调研 Top5 建议第 5 项）：
- 候选组合按下方规则静态枚举，实际收录由预热时的全量计数决定，
  岗位数 < MIN_JOBS 的候选不出页、不进 sitemap/IndexNow；
- 全部收录专题按岗位数排序，总数上限 MAX_TOPICS（30–60 目标区间）。

组合规则（kind）：
- buxian      省 × 不限专业 × 体制内（positions 专业字段含「不限」）
- edu         省 × 学历 × 体制内（edu_level_norm 精确匹配）
- campus_city 热门城市 × 应届校招（campus_jobs.locations 子串命中）
- campus_soe  热门城市 × 应届 × 央国企（company_type 含 央国企/国企）
- bz_edu      省 × 教师编制（bianzhi_jobs.category = 教育系统）
- bz_med      省 × 医疗卫生编制（bianzhi_jobs.category = 医疗系统）
"""

from urllib.parse import quote

MIN_JOBS = 100
MAX_TOPICS = 60

# 每类候选的收录上限（按岗位数取 Top，控制专题总量与预热时长）
KIND_CAPS = {
    "buxian": 12,
    "edu": 16,
    "campus_city": 12,
    "campus_soe": 8,
    "bz_edu": 8,
    "bz_med": 8,
}

# 校招专题的热门城市（与前端 CITY_CHIPS 口径一致；locations 为多地文本，按子串命中）
TOPIC_CITIES = [
    ("beijing", "北京"), ("shanghai", "上海"), ("guangzhou", "广州"),
    ("shenzhen", "深圳"), ("hangzhou", "杭州"), ("nanjing", "南京"),
    ("chengdu", "成都"), ("wuhan", "武汉"), ("xian", "西安"),
    ("suzhou", "苏州"), ("tianjin", "天津"), ("chongqing", "重庆"),
    ("changsha", "长沙"), ("qingdao", "青岛"), ("zhengzhou", "郑州"),
    ("hefei", "合肥"),
]

# 学历专题维度：(slug 片段, edu_level_norm 精确值, 展示名)
TOPIC_EDUS = [
    ("dazhuan", "大专/中专", "大专"),
    ("shuoshi", "硕士研究生", "硕士研究生"),
]

SOE_TYPES = ("央国企", "国企")

KIND_LABELS = {
    "buxian": "不限专业·体制内",
    "edu": "学历门槛·体制内",
    "campus_city": "热门城市·应届校招",
    "campus_soe": "央国企校招",
    "bz_edu": "教师编制",
    "bz_med": "医疗编制",
}


def build_candidates(provinces: list) -> dict:
    """候选专题字典 slug -> 定义；provinces 为 seo.PROVINCES [(slug, 省名)]。"""
    out: dict = {}

    def add(slug, kind, name, h1, desc, deep, board):
        assert slug not in out, f"duplicate topic slug: {slug}"
        out[slug] = {"slug": slug, "kind": kind, "name": name, "h1": h1,
                     "desc": desc, "deep": deep, "board": board}

    for ps, prov in provinces:
        add(f"{ps}-buxian", "buxian", f"{prov}不限专业",
            f"{prov}不限专业可报的体制内岗位",
            f"{prov}专业要求为「不限」或包含不限表述的公务员、事业单位等体制内岗位，"
            f"任何专业均可报考，适合专业冷门或想扩大选择面的考生。",
            f"/?province={quote(prov)}&major={quote('不限')}", "positions",
            )
        out[f"{ps}-buxian"]["prov"] = prov
        for es, edu_norm, edu_short in TOPIC_EDUS:
            slug = f"{ps}-{es}"
            add(slug, "edu", f"{prov}{edu_short}可报",
                f"{prov}{edu_short}学历可报的体制内岗位",
                f"{prov}学历要求为「{edu_norm}」的公务员、事业单位等体制内岗位汇总，"
                f"含考试类型分布与最新岗位样例。",
                f"/?province={quote(prov)}&edu_level={quote(edu_norm)}", "positions")
            out[slug]["prov"] = prov
            out[slug]["edu"] = edu_norm
        add(f"{ps}-jiaoshibian", "bz_edu", f"{prov}教师编",
            f"{prov}教师编制招聘公告岗位",
            f"{prov}教育系统在招的编制教师岗位公告汇总，含单位、学历要求与报名截止时间。",
            f"/?board=bianzhi&bpreset=edu&prov={quote(prov)}", "bianzhi")
        out[f"{ps}-jiaoshibian"]["prov"] = prov
        add(f"{ps}-yiliaobian", "bz_med", f"{prov}医疗编",
            f"{prov}医疗卫生编制招聘公告岗位",
            f"{prov}医疗系统在招的编制医护岗位公告汇总，含单位、学历要求与报名截止时间。",
            f"/?board=bianzhi&bpreset=med&prov={quote(prov)}", "bianzhi")
        out[f"{ps}-yiliaobian"]["prov"] = prov

    for cs, city in TOPIC_CITIES:
        add(f"{cs}-yingjie", "campus_city", f"{city}应届校招",
            f"{city}应届生校招/社招岗位",
            f"工作地点含{city}的校招与社招岗位汇总，覆盖央国企、外企、互联网等方向，"
            f"含批次、截止时间与投递入口。",
            f"/?board=campus&city={quote(city)}", "campus")
        out[f"{cs}-yingjie"]["city"] = city
        add(f"{cs}-guoqi", "campus_soe", f"{city}央国企校招",
            f"{city}央国企校招岗位（应届生）",
            f"工作地点含{city}、企业类型为央企/国企的校招岗位汇总，"
            f"编制外但稳定性强，适合应届生投递。",
            f"/?board=campus&ctype={quote(','.join(SOE_TYPES))}&city={quote(city)}",
            "campus")
        out[f"{cs}-guoqi"]["city"] = city
    return out
