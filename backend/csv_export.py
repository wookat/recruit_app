"""列表 CSV 导出公共工具：文件名清洗与流式 CSV 响应。"""
import csv
import io
import re
from urllib.parse import quote

from fastapi.responses import StreamingResponse

_FNAME_RE = re.compile(r"[^\w\u4e00-\u9fff·\-（）()]+")


def safe_fname(fname, default: str) -> str:
    """清洗前端传入的文件名（去路径/特殊字符，限长 80），为空时回退默认名。"""
    name = _FNAME_RE.sub("", (fname or "").strip())[:80]
    return name or default


def stream_csv(rows, cols, filename: str) -> StreamingResponse:
    """逐行流式输出带 UTF-8 BOM 的 CSV；cols 为 (attr, 中文列名) 列表。"""

    def iter_csv():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([label for _, label in cols])
        yield "\ufeff" + buf.getvalue()
        for row in rows:
            buf.seek(0)
            buf.truncate(0)
            writer.writerow([str(getattr(row, attr, "") or "") for attr, _ in cols])
            yield buf.getvalue()

    return StreamingResponse(
        iter_csv(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}.csv"
        },
    )


def write_csv(rows, cols, path: str) -> int:
    """逐行写 CSV 文件（utf-8-sig 带 BOM），返回行数。"""
    n = 0
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([label for _, label in cols])
        for row in rows:
            writer.writerow([str(getattr(row, attr, "") or "") for attr, _ in cols])
            n += 1
    return n
