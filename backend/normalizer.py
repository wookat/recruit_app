import json
import os
import re
from typing import Dict, List, Set, Optional

_PC_PATH = os.path.join(os.path.dirname(__file__), "data", "pc.json")


def _normalize_name(s: str) -> str:
    if not s:
        return s
    s = s.strip()
    suffixes = [
        "维吾尔自治区", "回族自治区", "壮族自治区", "广西壮族自治区",
        "内蒙古自治区", "自治区", "特别行政区", "自治州", "自治县",
        "新区", "地区", "盟", "市辖区", "街道", "乡镇", "镇", "乡",
        "省", "市", "县", "区", "旗",
    ]
    for suffix in suffixes:
        if s.endswith(suffix) and len(s) > len(suffix):
            s = s[: -len(suffix)]
    # 去掉行政区划连接残留，如“上海市浦东新区” => “上海浦东”
    s = s.lstrip("市县区")
    return s


def _load_pc():
    if not os.path.exists(_PC_PATH):
        return {}
    with open(_PC_PATH, encoding="utf-8") as f:
        return json.load(f)


_PC_DATA = _load_pc()

PROVINCE_TO_CITIES: Dict[str, List[str]] = {}
CITY_TO_PROVINCE: Dict[str, str] = {}
ALL_PROVINCES: List[str] = []
ALL_CITIES: List[str] = []
# 行政区划顺序（pc.json 原始顺序），供前端展示用
PROVINCE_DISPLAY_ORDER: List[str] = []

# 直辖市下属区域列表
MUNICIPAL_DISTRICTS: Dict[str, List[str]] = {}
DISTRICT_TO_MUNICIPALITY: Dict[str, str] = {}

for prov_raw, cities_raw in _PC_DATA.items():
    prov = _normalize_name(prov_raw)
    if not prov:
        continue
    ALL_PROVINCES.append(prov)
    if prov not in PROVINCE_DISPLAY_ORDER:
        PROVINCE_DISPLAY_ORDER.append(prov)
    city_shorts: List[str] = []
    for c in cities_raw:
        sc = _normalize_name(c)
        if sc and sc not in city_shorts:
            city_shorts.append(sc)
            CITY_TO_PROVINCE[sc] = prov
    if prov in ("北京", "天津", "上海", "重庆"):
        # 直辖市的 cities 实际上是区县
        MUNICIPAL_DISTRICTS[prov] = city_shorts.copy()
        for d in city_shorts:
            DISTRICT_TO_MUNICIPALITY[d] = prov
        # 直辖市本身也作为城市标签
        city_shorts = [prov]
    PROVINCE_TO_CITIES[prov] = city_shorts
    ALL_CITIES.extend(city_shorts)

# 去重并排序，长名称优先，避免短城市名误匹配
ALL_PROVINCES = sorted(set(ALL_PROVINCES), key=lambda x: (-len(x), x))
ALL_CITIES = sorted(set(ALL_CITIES), key=lambda x: (-len(x), x))


def normalize_edu(edu: Optional[str]) -> str:
    if not edu:
        return "其他/不限"
    e = str(edu).strip().lower()
    if e in ("√", "", "不限", "详见公告", "无", "nan"):
        return "其他/不限"
    if "博士" in e or "phd" in e or "ph.d" in e:
        return "博士研究生"
    if "硕士" in e or ("研究生" in e and "博士" not in e):
        return "硕士研究生"
    if "本科" in e or ("大学" in e and "专科" not in e):
        return "本科"
    if any(k in e for k in ("大专", "中专", "中技", "高职", "专科")):
        return "大专/中专"
    return "其他/不限"


def normalize_job_type(jt: Optional[str]) -> str:
    if not jt:
        return "其他"
    j = str(jt).strip()
    if any(k in j for k in ("事业单位", "事业编")):
        return "事业单位/事业编"
    if "公务员" in j:
        return "公务员"
    if "军队文职" in j:
        return "军队文职"
    if "选调生" in j:
        return "选调生"
    if any(k in j for k in ("央企", "国企", "国有企业", "中央企业")):
        return "央企/国企"
    if any(k in j for k in ("银行",)):
        return "银行"
    if any(k in j for k in ("民营", "股份制", "中外合资", "上市公司", "其他")):
        return "其他企业"
    return j


def _extract_district(remainder: str) -> Optional[str]:
    r = _normalize_name(remainder)
    if r and len(r) >= 2:
        return r
    return None


def _rem_matches_province_city(prov: str, rem: str) -> bool:
    """判断 province 前缀去掉后的余下部分是否真的是该省/直辖市的下辖区域。"""
    if not rem:
        return True
    for city in PROVINCE_TO_CITIES.get(prov, []):
        if city and (rem.startswith(city) or city in rem):
            return True
    if prov in MUNICIPAL_DISTRICTS:
        for d in MUNICIPAL_DISTRICTS[prov]:
            if d and (rem.startswith(d) or d in rem):
                return True
    return False


def parse_location_tags(work_location: Optional[str]) -> List[str]:
    if not work_location:
        return []
    tags: Set[str] = set()
    # 按常见分隔符拆分
    segments = re.split(r"[-,，、；;\s]+", str(work_location))
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        seg_norm = _normalize_name(seg)
        if not seg_norm or seg_norm in ("中国", "全国", "不限"):
            continue

        matched = False
        # 1. 以省份开头
        for prov in ALL_PROVINCES:
            if seg_norm.startswith(prov):
                rem = seg_norm[len(prov):]
                if not _rem_matches_province_city(prov, rem):
                    continue
                tags.add(prov)
                matched = True
                # 匹配该省城市
                for city in PROVINCE_TO_CITIES.get(prov, []):
                    if not rem:
                        break
                    if city and rem.startswith(city):
                        tags.add(city)
                        district = _extract_district(rem[len(city):])
                        if district:
                            tags.add(district)
                        break
                    elif city and city in rem:
                        tags.add(city)
                        # 不 break，继续加入城市后继续匹配可能的城市
                break
        if matched:
            # 直辖市情况下进一步识别区县，如“上海市浦东新区”
            if prov in MUNICIPAL_DISTRICTS and rem:
                rem_norm = _normalize_name(rem)
                for d in MUNICIPAL_DISTRICTS[prov]:
                    if d and rem_norm.startswith(d):
                        tags.add(d)
                        break
                    elif d and d in rem_norm:
                        tags.add(d)
            continue

        # 2. 直辖市下辖区域：上海-浦东新区
        for muni, districts in MUNICIPAL_DISTRICTS.items():
            if seg_norm.startswith(muni):
                tags.add(muni)
                rem = seg_norm[len(muni):]
                for d in districts:
                    if d and rem.startswith(d):
                        tags.add(d)
                        break
                    elif d and d in rem:
                        tags.add(d)
                # 去掉市名后的剩余作为区县
                district = _extract_district(rem)
                if district and district not in (MUNICIPAL_DISTRICTS.get(muni) or []):
                    tags.add(district)
                matched = True
                break
        if matched:
            continue

        # 3. 未以省开头：直接包含某个城市
        for city in ALL_CITIES:
            if city and city in seg_norm:
                tags.add(city)
                prov = CITY_TO_PROVINCE.get(city)
                if prov:
                    tags.add(prov)
                if seg_norm.startswith(city):
                    district = _extract_district(seg_norm[len(city):])
                    if district:
                        tags.add(district)
                matched = True
                break

        # 4. 独立区县名，例如“浦东新区”、“瑶海区”
        if not matched and seg_norm in DISTRICT_TO_MUNICIPALITY:
            muni = DISTRICT_TO_MUNICIPALITY[seg_norm]
            tags.add(muni)
            tags.add(seg_norm)
            matched = True

        # 5. 未识别出的片段作为原始标签兜底
        if not matched:
            tags.add(seg)
            if seg_norm and seg_norm != seg:
                tags.add(seg_norm)

    return sorted(t for t in tags if t and len(t) >= 2 and not t.startswith("("))


def location_tree() -> List[Dict]:
    """返回前端级联选择需要的数据结构：省 -> 城市列表"""
    return [
        {"province": prov, "cities": PROVINCE_TO_CITIES.get(prov, [])}
        for prov in PROVINCE_DISPLAY_ORDER
        if PROVINCE_TO_CITIES.get(prov)
    ]
