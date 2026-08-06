"""AI 语义专业扩展：用 LLM 把用户专业归入专业大类并给出同大类相关专业词，
失败时回退到 major_map 静态映射。结果按专业组合缓存 7 天。"""
import hashlib
import json
import os
from typing import List, Tuple

import requests

from cache import get_redis
from major_map import MAJOR_GROUPS, expand_major

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
CACHE_TTL = 7 * 86400
MAX_TERMS = 24

_PROMPT = (
    "你是公务员/事业单位/校招岗位专业匹配助手。用户的专业是：{majors}。\n"
    "请给出：1) 每个专业在中国公务员考试专业目录中所属的专业大类名称；"
    "2) 同大类下岗位专业要求里常见的相关专业关键词（含近义表述），"
    "用于在岗位的「专业要求」文本里做包含匹配。\n"
    "严格要求：只能扩展与用户专业同大类或课程体系高度重叠的强相关专业，"
    "不要扩展仅名称相似或弱相关的专业；宁缺毋滥。"
    "每个扩展词附一句理由（不超过 20 字，说明与用户专业的关系）。\n"
    '只输出 JSON，格式：{{"categories": ["大类1", ...], '
    '"terms": [{{"term": "关键词1", "reason": "理由1"}}, ...]}}，'
    "terms 不超过 16 个、每个 term 2-12 字、不要重复用户原词。"
)


def _rules_expand(majors: List[str]) -> Tuple[List[str], List[str]]:
    """静态映射回退：返回 (categories, related_terms)。"""
    cats: List[str] = []
    terms: List[str] = []
    for m in majors:
        for cat, group_terms in MAJOR_GROUPS.items():
            if any(m in t or t in m for t in group_terms):
                if cat not in cats:
                    cats.append(cat)
                break
        for t in expand_major(m)[1:]:
            if t not in terms and t not in majors:
                terms.append(t)
    return cats, terms[:MAX_TERMS]


def expand_majors_semantic(majors: List[str]) -> dict:
    """返回 {'categories': [...], 'terms': [...], 'term_reasons': {term: reason},
    'source': 'ai'|'rules'}。"""
    majors = [m.strip() for m in majors if m and m.strip()][:5]
    if not majors:
        return {"categories": [], "terms": [], "term_reasons": {}, "source": "rules"}
    key = "ai_major_expand:v2:" + hashlib.md5("|".join(sorted(majors)).encode()).hexdigest()
    try:
        cached = get_redis().get(key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    result = None
    if DEEPSEEK_API_KEY:
        try:
            r = requests.post(
                DEEPSEEK_URL,
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                json={
                    "model": "deepseek-chat",
                    "messages": [{"role": "user", "content": _PROMPT.format(majors="、".join(majors))}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.2,
                    "max_tokens": 900,
                },
                timeout=12,
            )
            r.raise_for_status()
            data = json.loads(r.json()["choices"][0]["message"]["content"])
            cats = [str(c).strip() for c in data.get("categories", []) if str(c).strip()][:8]
            terms: List[str] = []
            reasons: dict = {}
            for item in data.get("terms", []):
                if isinstance(item, dict):
                    term = str(item.get("term", "")).strip()
                    reason = str(item.get("reason", "")).strip()[:40]
                else:
                    term, reason = str(item).strip(), ""
                if not (2 <= len(term) <= 12) or term in majors or term in terms:
                    continue
                terms.append(term)
                if reason:
                    reasons[term] = reason
                if len(terms) >= MAX_TERMS:
                    break
            if terms:
                result = {"categories": cats, "terms": terms, "term_reasons": reasons, "source": "ai"}
        except Exception:
            result = None
    if result is None:
        cats, terms = _rules_expand(majors)
        reasons = {t: "同大类专业（规则映射）" for t in terms}
        result = {"categories": cats, "terms": terms, "term_reasons": reasons, "source": "rules"}
    try:
        get_redis().setex(key, CACHE_TTL, json.dumps(result, ensure_ascii=False))
    except Exception:
        pass
    return result
