# -*- coding: utf-8 -*-
"""Reusable normalization helpers (v2) for positions data.

Pure functions, no DB access. Used by run_etl.py and can be reused at ingest time.
"""
import hashlib
import json
import os
import re
from typing import Dict, List, Optional, Tuple

_PC_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "pc.json")

MUNICIPALITIES = ("北京", "天津", "上海", "重庆")

_PROV_SUFFIXES = ("维吾尔自治区", "回族自治区", "壮族自治区", "自治区", "特别行政区", "省", "市")
_CITY_SUFFIXES = (
    "哈尼族彝族自治州", "布依族苗族自治州", "苗族侗族自治州", "土家族苗族自治州",
    "傣族景颇族自治州", "蒙古族藏族自治州", "柯尔克孜自治州", "傈僳族自治州",
    "藏族羌族自治州", "回族自治州", "朝鲜族自治州", "藏族自治州", "彝族自治州",
    "傣族自治州", "白族自治州", "蒙古自治州", "自治州", "地区", "林区", "盟", "市",
)
_DISTRICT_RE = re.compile(r"^[\u4e00-\u9fa5]{1,10}(区|县|旗|市|镇|乡|街道)$")

NON_GEO_SEGMENTS = {"中国", "全国", "不限", "详见公告", "海外", "各地", "全省", "全市"}
PROVINCE_ONLY_HINTS = ("省直", "省属", "省本级", "省级", "垂直管理", "省垂直")

SPECIAL_LOCATIONS = {
    "雄安新区": ("河北", "雄安新区", None),
    "雄安": ("河北", "雄安新区", None),
}


def _strip_prov(s: str) -> str:
    for suf in _PROV_SUFFIXES:
        if s.endswith(suf) and len(s) > len(suf):
            return s[: -len(suf)]
    return s


def _strip_city(s: str) -> str:
    for suf in _CITY_SUFFIXES:
        if s.endswith(suf) and len(s) > len(suf):
            return s[: -len(suf)]
    return s


def _load_pc() -> Dict[str, List[str]]:
    if not os.path.exists(_PC_PATH):
        return {}
    with open(_PC_PATH, encoding="utf-8") as f:
        return json.load(f)


_PC = _load_pc()

# province short name -> list of (variant, city_short); variants sorted longest-first
PROVINCES: List[str] = []
PROV_VARIANTS: List[Tuple[str, str]] = []  # (variant, prov_short)
PROV_CITIES: Dict[str, List[Tuple[str, str]]] = {}  # prov_short -> [(variant, city_short)]
CITY_TO_PROV: Dict[str, str] = {}
MUNI_DISTRICTS: Dict[str, List[str]] = {}
ALL_CITY_VARIANTS: List[Tuple[str, str]] = []  # (variant, city_short)
DISTRICT_TO_MUNI: Dict[str, str] = {}

for _prov_raw, _cities_raw in _PC.items():
    _p = _strip_prov(_prov_raw)
    PROVINCES.append(_p)
    for v in {_prov_raw, _p}:
        PROV_VARIANTS.append((v, _p))
    variants: List[Tuple[str, str]] = []
    if _p in MUNICIPALITIES:
        MUNI_DISTRICTS[_p] = []
        for c in _cities_raw:
            MUNI_DISTRICTS[_p].append(c)
            DISTRICT_TO_MUNI[c] = _p
            short = c[:-1] if c.endswith(("区", "县")) and len(c) > 2 else c
            if short != c:
                DISTRICT_TO_MUNI[short] = _p
        CITY_TO_PROV[_p] = _p
        variants.append((_p, _p))
    else:
        for c in _cities_raw:
            cs = _strip_city(c)
            CITY_TO_PROV[cs] = _p
            for v in {c, cs}:
                variants.append((v, cs))
    variants.sort(key=lambda t: -len(t[0]))
    PROV_CITIES[_p] = variants
    ALL_CITY_VARIANTS.extend(variants)

PROV_VARIANTS.sort(key=lambda t: -len(t[0]))
ALL_CITY_VARIANTS.sort(key=lambda t: -len(t[0]))


def _extract_district(rem: str, prov: Optional[str] = None) -> Optional[str]:
    rem = rem.strip("-—－ ")
    if not rem:
        return None
    if prov in MUNI_DISTRICTS:
        for d in MUNI_DISTRICTS[prov]:
            if rem.startswith(d) or rem.startswith(d[:-1]):
                return d
    if _DISTRICT_RE.match(rem):
        return rem
    return None


def parse_location(work_location: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str], List[str]]:
    """Parse a work_location string into (province, city, district, tags).

    province/city/district are from the FIRST resolved segment; tags cover all
    segments (provinces + cities + districts only — no free-text garbage tags).
    """
    if not work_location:
        return None, None, None, []
    first: Optional[Tuple[Optional[str], Optional[str], Optional[str]]] = None
    tags: List[str] = []

    def add(*ts):
        for t in ts:
            if t and t not in tags:
                tags.append(t)

    segments = re.split(r"[,，、；;/\s]+", str(work_location).strip())
    for seg in segments:
        seg = seg.strip()
        if not seg or seg in NON_GEO_SEGMENTS:
            continue
        prov = city = district = None

        if seg in SPECIAL_LOCATIONS or seg.replace("-", "") in SPECIAL_LOCATIONS:
            prov, city, district = SPECIAL_LOCATIONS.get(seg) or SPECIAL_LOCATIONS[seg.replace("-", "")]
        else:
            # 1. province prefix (longest variant first)
            for pv, p in PROV_VARIANTS:
                if seg.startswith(pv):
                    prov = p
                    rem = seg[len(pv):].lstrip("-—－ ")
                    if prov in MUNICIPALITIES:
                        city = prov
                        district = _extract_district(rem, prov)
                    elif any(h in rem for h in PROVINCE_ONLY_HINTS) or not rem:
                        pass
                    else:
                        for cv, cs in PROV_CITIES.get(prov, []):
                            if rem.startswith(cv):
                                city = cs
                                district = _extract_district(rem[len(cv):], prov)
                                break
                        if city is None:
                            for cv, cs in PROV_CITIES.get(prov, []):
                                if cv in rem:
                                    city = cs
                                    break
                    break
            # 2. city prefix without province
            if prov is None:
                for cv, cs in ALL_CITY_VARIANTS:
                    if seg.startswith(cv):
                        prov = CITY_TO_PROV.get(cs)
                        city = cs
                        district = _extract_district(seg[len(cv):], prov)
                        break
            # 3. standalone municipal district (e.g. 浦东新区)
            if prov is None and seg in DISTRICT_TO_MUNI:
                prov = DISTRICT_TO_MUNI[seg]
                city = prov
                district = seg
            # 4. contains a city name anywhere
            if prov is None:
                for cv, cs in ALL_CITY_VARIANTS:
                    if len(cv) >= 2 and cv in seg:
                        prov = CITY_TO_PROV.get(cs)
                        city = cs
                        break

        if prov:
            add(prov, city, district)
            if first is None:
                first = (prov, city, district)

    if first is None:
        return None, None, None, tags
    return first[0], first[1], first[2], tags


_EXAM_TYPE_RULES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"国家公务员|国考"), "国家公务员考试"),
    (re.compile(r"(公务员考试|公务员招录|省考)"), "省级公务员考试"),
    (re.compile(r"军队文职"), "军队文职招考"),
    (re.compile(r"选调"), "选调生"),
    (re.compile(r"事业单位招聘|事业编"), "事业单位招聘"),
    (re.compile(r"^(管理岗|管理岗位|管理)([一二三四五六七八九十]+级.*|十级.*|类.*)?$"), "管理岗"),
    (re.compile(r"^专业技术"), "专业技术岗"),
    (re.compile(r"^工勤"), "工勤技能岗"),
    (re.compile(r"行政执法"), "行政执法类"),
    (re.compile(r"^(综合类|综合岗|综合管理)"), "综合管理类"),
    (re.compile(r"(医疗|医学|临床|医技|药剂|药学)"), "医疗卫生"),
    (re.compile(r"护理"), "护理"),
    (re.compile(r"(高等教育|高校|教育|教师|教学)"), "教育教学"),
    (re.compile(r"(科学研究|科研)"), "科学研究"),
    (re.compile(r"(工程技术|工程)"), "工程技术"),
    (re.compile(r"(行政管理|普通职位)"), "综合管理类"),
    (re.compile(r"(银行|农信|农商)"), "银行招聘"),
    (re.compile(r"(央企|国企|校园招聘|校招|社会招聘)"), "企业招聘"),
]


def normalize_exam_type(exam_type: Optional[str]) -> Optional[str]:
    if not exam_type:
        return None
    e = str(exam_type).strip()
    for pat, norm in _EXAM_TYPE_RULES:
        if pat.search(e):
            return norm
    return "其他"


_UNLIMITED = {"不限", "不限专业", "专业不限", "无", "无限制", "不限。", "/", "—", "-", "）", "(", ")", "详见公告", "见公告", "nan"}
_MAJOR_SPLIT_RE = re.compile(
    r"专业要求[:：]?\s*(?P<ug>.*?)(?:。|；|;)?\s*研究生专业要求[:：]?\s*(?P<g>.*?)(?:。|；|;)?\s*$",
    re.S,
)
_COLLEGE_RE = re.compile(r"(?:专科|大专)(?:生)?专业要求[:：]?\s*(?P<c>[^。；;]*)")


def clean_major(val: Optional[str]) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip().strip("。；;")
    if not s or s in _UNLIMITED:
        return "不限" if s and s not in ("nan", "") else None
    if s.lower() in ("nan", "none", "null"):
        return None
    return s


def split_major(raw_major: Optional[str], undergrad: Optional[str], grad: Optional[str]):
    """Return (undergrad_major, grad_major, college_major) using raw_major when
    the split fields still contain the combined blob or are empty."""
    ug, g, col = undergrad, grad, None
    if raw_major:
        cm = _COLLEGE_RE.search(raw_major)
        if cm:
            col = cm.group("c")
    for src in (raw_major, undergrad):
        if src and "研究生专业要求" in src:
            src = _COLLEGE_RE.sub("", src).lstrip("。；; ")
            m = _MAJOR_SPLIT_RE.search(src)
            if m:
                ug = m.group("ug")
                g = m.group("g")
            break
    return clean_major(ug), clean_major(g), clean_major(col)


_HASH_KEYS = [
    "year", "job_type", "exam_type", "employer", "position_example",
    "edu_requirement", "undergrad_major", "grad_major", "exam_form",
    "signup_time", "exam_time", "special_requirements", "work_location",
    "raw_major",
]


def content_hash_v2(rec: Dict) -> str:
    """Content-only hash: excludes source_url / notes so re-scrapes of the same
    posting under a different URL collapse to one row."""
    s = "|".join("" if rec.get(k) is None else str(rec.get(k)).strip() for k in _HASH_KEYS)
    return hashlib.md5(s.encode("utf-8")).hexdigest()
