"""入库层持久清洗规则（refresh_feishu 每日同步与 import_* 全量导入共用）。

规则保守，只匹配明确的非岗位内容：
- 编制导流/说明行：单位名或类型含 http(s):// 链接、「更多…信息」「直接在…查看」句式；
- 校招专业要求口语句：整句为「…哦 宝宝~」占位则置空，仅句尾语气词则截断。
"""
import re

# 编制导流/说明行：employer / job_type 含链接或导流句式（非真实岗位）
BIANZHI_JUNK_PATTERN = r"https?://|更多[^，。;；]{0,40}信息|直接在[^，。;；]{0,40}查看"
_BIANZHI_JUNK_RE = re.compile(BIANZHI_JUNK_PATTERN)


def is_bianzhi_junk_row(d: dict) -> bool:
    """判定编制导流/说明行：employer 或 job_type 命中导流句式即不入库。"""
    for field in ("employer", "job_type"):
        v = (d.get(field) or "").strip()
        if v and _BIANZHI_JUNK_RE.search(v):
            return True
    return False


# 校招专业要求：整句占位（源表运营口语，如「…第八点哦 宝宝~」）
MAJOR_PLACEHOLDER_PATTERN = r"宝宝\s*[~～]"
_MAJOR_PLACEHOLDER_RE = re.compile(MAJOR_PLACEHOLDER_PATTERN)
# 句尾语气词（仅去尾，不动正文）
MAJOR_TAIL_PATTERN = r"[哦呀啦嘞哈][~～!！。.\s]*$"
_MAJOR_TAIL_RE = re.compile(MAJOR_TAIL_PATTERN)


def clean_major_requirement(v: str) -> str:
    """校招 major_requirement 口语清洗：占位句置空（前端显「—」），句尾语气词截断。"""
    s = (v or "").strip()
    if not s:
        return s
    if _MAJOR_PLACEHOLDER_RE.search(s):
        return ""
    return _MAJOR_TAIL_RE.sub("", s).strip()
