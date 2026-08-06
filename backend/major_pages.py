"""专业反查 SEO 页（/major）的专业词表与匹配口径。

词表来源与口径（R259）：
- 来源：对库内 positions.undergrad_major / grad_major / raw_major 三个专业字段
  （2026-08 快照，约 89 万条有效岗位）做分词频次统计，取高频出现的具体专业名，
  与教育部《普通高等学校本科专业目录》的规范名称及 major_map.MAJOR_GROUPS
  大类口径对齐后人工归一；含少量高频研究生学科名（如 内科学、课程与教学论）。
- 匹配口径：不做智能猜测，按「专业名子串命中」计——
  体制内 positions 命中 undergrad_major/grad_major/raw_major 任一字段，
  校招 campus_jobs 与编制 bianzhi_jobs 命中 major_requirement 字段。
  专业大类表述（如「法学类」）天然包含具体专业名时一并命中（如 法学）。
- 命中不了（全站 0 岗位）的专业不出页、不进 sitemap/IndexNow。
"""

# 学科门类 -> [(slug, 专业名)]；slug 为拼音，全站唯一
MAJOR_DISCIPLINES: list = [
    ("哲学", [
        ("zhexue", "哲学"),
    ]),
    ("经济学", [
        ("jingjixue", "经济学"),
        ("jinrongxue", "金融学"),
        ("caizhengxue", "财政学"),
        ("shuishouxue", "税收学"),
        ("guojijingjiyumaoyi", "国际经济与贸易"),
        ("baoxianxue", "保险学"),
        ("jingjitongjixue", "经济统计学"),
        ("jinronggongcheng", "金融工程"),
        ("touzixue", "投资学"),
        ("shuzijingji", "数字经济"),
        ("yingyongjingjixue", "应用经济学"),
    ]),
    ("法学", [
        ("faxue", "法学"),
        ("zhishichanquan", "知识产权"),
        ("shehuigongzuo", "社会工作"),
        ("shehuixue", "社会学"),
        ("zhengzhixueyuxingzhengxue", "政治学与行政学"),
        ("makesizhuyililun", "马克思主义理论"),
        ("sixiangzhengzhijiaoyu", "思想政治教育"),
        ("zhianxue", "治安学"),
        ("zhenchaxue", "侦查学"),
        ("jijianjianchaxue", "纪检监察学"),
        ("minshangfaxue", "民商法学"),
    ]),
    ("教育学", [
        ("jiaoyuxue", "教育学"),
        ("xueqianjiaoyu", "学前教育"),
        ("xiaoxuejiaoyu", "小学教育"),
        ("tiyujiaoyu", "体育教育"),
        ("teshujiaoyu", "特殊教育"),
        ("jiaoyujishuxue", "教育技术学"),
        ("kechengyujiaoxuelun", "课程与教学论"),
    ]),
    ("文学", [
        ("hanyuyanwenxue", "汉语言文学"),
        ("hanyuguojijiaoyu", "汉语国际教育"),
        ("mishuxue", "秘书学"),
        ("yingyu", "英语"),
        ("riyu", "日语"),
        ("eyu", "俄语"),
        ("fayu", "法语"),
        ("deyu", "德语"),
        ("fanyi", "翻译"),
        ("shangwuyingyu", "商务英语"),
        ("xinwenxue", "新闻学"),
        ("chuanboxue", "传播学"),
        ("guanggaoxue", "广告学"),
        ("bianjichubanxue", "编辑出版学"),
        ("wangluoyuxinmeiti", "网络与新媒体"),
        ("xinwenyuchuanbo", "新闻与传播"),
    ]),
    ("历史学", [
        ("lishixue", "历史学"),
        ("kaoguxue", "考古学"),
    ]),
    ("理学", [
        ("shuxueyuyingyongshuxue", "数学与应用数学"),
        ("xinxiyujisuankexue", "信息与计算科学"),
        ("wulixue", "物理学"),
        ("huaxue", "化学"),
        ("yingyonghuaxue", "应用化学"),
        ("shengwukexue", "生物科学"),
        ("shengwujishu", "生物技术"),
        ("tongjixue", "统计学"),
        ("yingyongtongji", "应用统计"),
        ("dilikexue", "地理科学"),
        ("shengtaixue", "生态学"),
        ("xinlixue", "心理学"),
    ]),
    ("工学", [
        ("jisuanjikexueyujishu", "计算机科学与技术"),
        ("ruanjiangongcheng", "软件工程"),
        ("wangluogongcheng", "网络工程"),
        ("xinxianquan", "信息安全"),
        ("wangluokongjiananquan", "网络空间安全"),
        ("rengongzhineng", "人工智能"),
        ("shujukexueyudashujujishu", "数据科学与大数据技术"),
        ("wulianwanggongcheng", "物联网工程"),
        ("zhinengkexueyujishu", "智能科学与技术"),
        ("dianzixinxigongcheng", "电子信息工程"),
        ("dianzikexueyujishu", "电子科学与技术"),
        ("tongxingongcheng", "通信工程"),
        ("xinxiyutongxingongcheng", "信息与通信工程"),
        ("weidianzikexueyugongcheng", "微电子科学与工程"),
        ("zidonghua", "自动化"),
        ("dianqigongcheng", "电气工程"),
        ("jixiegongcheng", "机械工程"),
        ("jixieshejizhizao", "机械设计制造及其自动化"),
        ("cheliangongcheng", "车辆工程"),
        ("cailiaokexueyugongcheng", "材料科学与工程"),
        ("tumugongcheng", "土木工程"),
        ("jianzhuxue", "建筑学"),
        ("chengxiangguihua", "城乡规划"),
        ("geipaishuikexueyugongcheng", "给排水科学与工程"),
        ("shuilishuidiangongcheng", "水利水电工程"),
        ("shuiligongcheng", "水利工程"),
        ("cehuigongcheng", "测绘工程"),
        ("yaogankexueyujishu", "遥感科学与技术"),
        ("huanjinggongcheng", "环境工程"),
        ("huanjingkexue", "环境科学"),
        ("huaxuegongchengyugongyi", "化学工程与工艺"),
        ("zhiyaogongcheng", "制药工程"),
        ("shipinkexueyugongcheng", "食品科学与工程"),
        ("shipinzhiliangyuanquan", "食品质量与安全"),
        ("jiaotongyunshu", "交通运输"),
        ("jiaotonggongcheng", "交通工程"),
        ("anquangongcheng", "安全工程"),
        ("xiaofanggongcheng", "消防工程"),
        ("shengwugongcheng", "生物工程"),
        ("nengyuanyudongligongcheng", "能源与动力工程"),
    ]),
    ("农学", [
        ("nongxue", "农学"),
        ("yuanyi", "园艺"),
        ("zhiwubaohu", "植物保护"),
        ("linxue", "林学"),
        ("yuanlin", "园林"),
        ("dongwuyixue", "动物医学"),
        ("dongwukexue", "动物科学"),
        ("shuichanyangzhixue", "水产养殖学"),
        ("nongyeziyuanyuhuanjing", "农业资源与环境"),
    ]),
    ("医学", [
        ("linchuangyixue", "临床医学"),
        ("zhongyixue", "中医学"),
        ("zhongxiyilinchuangyixue", "中西医临床医学"),
        ("kouqiangyixue", "口腔医学"),
        ("mazuixue", "麻醉学"),
        ("yixueyingxiangxue", "医学影像学"),
        ("yixuejianyanjishu", "医学检验技术"),
        ("yufangyixue", "预防医学"),
        ("yaoxue", "药学"),
        ("zhongyaoxue", "中药学"),
        ("hulixue", "护理学"),
        ("kangfuzhiliaoxue", "康复治疗学"),
        ("neikexue", "内科学"),
        ("waikexue", "外科学"),
    ]),
    ("管理学", [
        ("gongshangguanli", "工商管理"),
        ("kuaijixue", "会计学"),
        ("caiwuguanli", "财务管理"),
        ("shenjixue", "审计学"),
        ("zichanpinggu", "资产评估"),
        ("renliziyuanguanli", "人力资源管理"),
        ("xingzhengguanli", "行政管理"),
        ("gonggongshiyeguanli", "公共事业管理"),
        ("laodongyushehuibaozhang", "劳动与社会保障"),
        ("tudiziyuanguanli", "土地资源管理"),
        ("danganxue", "档案学"),
        ("tushuguanxue", "图书馆学"),
        ("wuliuguanli", "物流管理"),
        ("dianzishangwu", "电子商务"),
        ("lvyouguanli", "旅游管理"),
        ("shichangyingxiao", "市场营销"),
        ("guojishangwu", "国际商务"),
        ("gonggongguanli", "公共管理"),
        ("gongchengguanli", "工程管理"),
        ("gongchengzaojia", "工程造价"),
    ]),
    ("艺术学", [
        ("yinyuexue", "音乐学"),
        ("meishuxue", "美术学"),
        ("shijuechuandasheji", "视觉传达设计"),
        ("huanjingsheji", "环境设计"),
        ("boyinyuzhuchiyishu", "播音与主持艺术"),
    ]),
]

# slug -> (专业名, 学科门类)
MAJOR_BY_SLUG: dict = {}
for _disc, _majors in MAJOR_DISCIPLINES:
    for _slug, _name in _majors:
        assert _slug not in MAJOR_BY_SLUG, f"duplicate major slug: {_slug}"
        MAJOR_BY_SLUG[_slug] = (_name, _disc)

SLUG_BY_MAJOR = {name: slug for slug, (name, _) in MAJOR_BY_SLUG.items()}

# 常见简称/别名 -> 规范 slug；命中别名 301 到规范页（索引页与 sitemap 仍只列规范 slug）
MAJOR_SLUG_ALIASES: dict = {
    "jisuanji": "jisuanjikexueyujishu",        # 计算机
    "jisuanjikexue": "jisuanjikexueyujishu",
    "falv": "faxue",                           # 法律 -> 法学
    "kuaiji": "kuaijixue",                     # 会计
    "linchuang": "linchuangyixue",             # 临床
    "hanyuyan": "hanyuyanwenxue",              # 汉语言
    "ruanjian": "ruanjiangongcheng",           # 软件
    "jinrong": "jinrongxue",                   # 金融
    "huli": "hulixue",                         # 护理
    "hushi": "hulixue",                        # 护士 -> 护理学
    "jingji": "jingjixue",                     # 经济
    "xinli": "xinlixue",                       # 心理
    "shuxue": "shuxueyuyingyongshuxue",        # 数学
    "tumu": "tumugongcheng",                   # 土木
    "jixie": "jixiegongcheng",                 # 机械
    "dianqi": "dianqigongcheng",               # 电气
    "tongji": "tongjixue",                     # 统计
    "shenji": "shenjixue",                     # 审计
    "caiwu": "caiwuguanli",                    # 财务
    "renliziyuan": "renliziyuanguanli",        # 人力资源
    "renli": "renliziyuanguanli",
    "xingzheng": "xingzhengguanli",            # 行政
    "gongshang": "gongshangguanli",            # 工商
    "shichang": "shichangyingxiao",            # 市场
    "wuliu": "wuliuguanli",                    # 物流
    "dashuju": "shujukexueyudashujujishu",     # 大数据
    "shuju": "shujukexueyudashujujishu",
    "xinwen": "xinwenxue",                     # 新闻
    "jiaoyu": "jiaoyuxue",                     # 教育
    "xueqian": "xueqianjiaoyu",                # 学前
    "zhongyi": "zhongyixue",                   # 中医
    "kouqiang": "kouqiangyixue",               # 口腔
    "yingyang": "yufangyixue",                 # 预防（营养口径归预防医学）
    "yufang": "yufangyixue",
    "huanjing": "huanjinggongcheng",           # 环境
    "tongxin": "tongxingongcheng",             # 通信
    "dianzixinxi": "dianzixinxigongcheng",     # 电子信息
    "wangluo": "wangluogongcheng",             # 网络
    "anquan": "anquangongcheng",               # 安全
    "jianzhu": "jianzhuxue",                   # 建筑
}
for _alias, _target in MAJOR_SLUG_ALIASES.items():
    assert _alias not in MAJOR_BY_SLUG, f"alias collides with canonical slug: {_alias}"
    assert _target in MAJOR_BY_SLUG, f"alias target missing: {_target}"


def resolve_major_alias(slug: str) -> str | None:
    """未命中规范 slug 时解析别名：显式别名表优先，其次唯一前缀匹配（≥4 字符）。"""
    if slug in MAJOR_SLUG_ALIASES:
        return MAJOR_SLUG_ALIASES[slug]
    if len(slug) >= 4:
        hits = [s for s in MAJOR_BY_SLUG if s.startswith(slug)]
        if len(hits) == 1:
            return hits[0]
    return None
