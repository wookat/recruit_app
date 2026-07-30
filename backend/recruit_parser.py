# -*- coding: utf-8 -*-
import pandas as pd
import re
import os
import zipfile
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

column_mapping = {
    '单位名称': ['选调机关', '部门名称', '单位名称', '选调单位', '用人司局', '用人单位', '招录机关', '主管部门', '用人单位名称', '选调部门', '机关', '组织部门', '招录单位', '用人单位及招考岗位_用人单位\n名    称'],
    '职位名称': ['职位名称', '选调职位', '岗位名称', '职位', '工作岗位', '岗位', '选调岗位', '招聘岗位', '招录职位', '用人单位及招考岗位_岗位\n名称'],
    '职位简介': ['职位简介', '从事工作', '岗位简介', '工作描述', '职位描述', '岗位描述', '职位说明', '用人单位及招考岗位_从事工作'],
    '岗位代码': ['岗位代码', '职位代码', '用人单位序号', '序号'],
    '招考人数': ['招考人数', '选调人数', '招聘人数', '人数', '招录人数', '计划人数', '名额', '招考数量', '招录名额', '用人单位及招考岗位_招考数量', '选调\n人数'],
    '学历要求': ['学历要求', '学历', '文化程度', '学历学位', '学历\n要求', '招考条件_学历', '招录条件'],
    '学位要求': ['学位要求', '学位', '学位\n要求', '招考条件_学位'],
    '专业要求': ['专业要求', '专业类别', '专业', '所学专业', '专业\n要求', '招考条件_所学专业'],
    '本科生专业要求': ['专业要求（本科）', '本科专业要求', '本科专业', '本科：', '本科'],
    '研究生专业要求': ['专业要求（研究生）', '研究生专业要求', '研究生专业', '研究生：', '研究生'],
    '政治面貌': ['政治面貌', '政治面目', '政治\n面貌', '政治'],
    '其他条件': ['其他条件', '其它条件', '备注', '附注', '其他要求', '其他说明', '其它要求', '资格条件', '其他', '招考条件_其他条件'],
    '联系电话': ['联系电话', '咨询电话', '联系方式', '考生咨询电话', '咨询电话1', '咨询电话2', '电话', '咨询电话'],
    '工作地点': ['市地', '工作地点', '工作地区', '所属地区', '地区', '工作城市', '工作\n地点'],
    '面试比例': ['面试人员比例', '面试比例', '入围比例', '开考比例', '比例', '用人单位及招考岗位_入围比例'],
    '来源类别': ['来源类别', '招考条件_来源\n类别'],
    '考试科目': ['考试类别', '考试科目', '考试专业科    目', '考试专业科目', '招考条件_考试专业科    目'],
    '职称': ['职称', '职业资格'],
    '基层工作最低年限': ['基层工作最低年限', '基层工作年限', '基层年限'],
    '服务基层项目工作经历': ['服务基层项目工作经历', '服务基层项目'],
    '面试阶段专业测试': ['是否在面试阶段组织专业能力测试', '面试阶段组织专业测试', '专业能力测试'],
    '部门网站': ['部门网站', '单位网站'],
    '招录高校范围': ['目标高校范围', '招录高校范围', '高校范围', '选调高校范围', '招录条件'],
}


def normalize_col(c):
    c = str(c).strip().replace('\n', '').replace(' ', '').replace('\xa0', '').replace('\t', '').replace('\u3000', '')
    return c


def flatten_multicolumn(cols):
    """Flatten a MultiIndex list of tuples into strings."""
    new_cols = []
    for c in cols:
        if isinstance(c, tuple):
            parts = [str(x) for x in c if x is not None and str(x) not in ['', 'nan', 'NaN']]
            new_cols.append('_'.join(parts))
        else:
            new_cols.append(str(c))
    return new_cols


def detect_header_info(df, max_scan=25):
    """Return (header_rows_list, has_multiheader)"""
    for i in range(min(max_scan, len(df))):
        row = [str(v).strip() for v in df.iloc[i].tolist() if pd.notna(v)]
        if len(row) < 5:
            continue
        joined = ''.join(row)
        if len(joined) > 800:
            continue
        avg_len = sum(len(x) for x in row) / len(row)
        if avg_len > 80:
            continue
        has_major = '专业' in joined
        has_degree = '学历' in joined or '学位' in joined or '高校' in joined
        has_position = '职位' in joined or '岗位' in joined or '单位' in joined or '招录' in joined
        if has_major and has_degree and has_position:
            # check whether this row has empty cells; if so, candidate for multi-header
            empty_count = sum(1 for v in df.iloc[i].tolist() if pd.isna(v) or str(v).strip() == '')
            if empty_count > 0 and i > 0:
                # previous row should also look like a header (>=5 non-empty cells, has header markers)
                prev = df.iloc[i - 1].dropna()
                if len(prev) >= 5:
                    prev_joined = ''.join(str(v).strip() for v in prev)
                    if ('专业' in prev_joined or '学历' in prev_joined or '学位' in prev_joined or
                            '职位' in prev_joined or '岗位' in prev_joined or '单位' in prev_joined):
                        return [i - 1, i], True
            return [i], False
    return [0], False


def map_columns(cols, mapping=None):
    if mapping is None:
        mapping = column_mapping
    result = {}
    cols_norm = [normalize_col(c) for c in cols]
    used = set()
    for key, candidates in mapping.items():
        found = False
        for cand in candidates:
            for ci, cn in enumerate(cols_norm):
                if ci in used:
                    continue
                if cand not in cn:
                    continue
                # avoid short ambiguous matches
                if cand == '学位' and '学历' in cn and cn != '学位':
                    continue
                if cand == '学历' and '学位要求' in cn:
                    continue
                # avoid short candidates matching code/description columns
                if cand in ('职位', '岗位') and ('代码' in cn or '描述' in cn or '简介' in cn) and cn not in (cand, cand + '名称'):
                    continue
                if cand == '专业' and ('测试' in cn or '科目' in cn):
                    continue
                result[key] = ci
                used.add(ci)
                found = True
                break
            if found:
                break
    return result


def split_major_text(text):
    text = str(text).strip()
    if not text or text in ['--', '无限制', '不限', 'NaN', 'nan']:
        return '', ''
    text = re.sub(r'[\n\r]+', ';', text)
    text = text.replace('；', ';')
    text = text.replace('或研究生', ';研究生')
    text = text.replace('或本科', ';本科')
    # remove all whitespace to fix "本 科" and "研 究 生" formatting, but keep semicolons/parentheses/commas
    text = re.sub(r'[\s\u200b\u3000]+', '', text)
    # If dash/colon prefixed markers exist, split by comma/semicolon and parse each token
    if re.search(r'(本科|专业硕士|研究生|硕士|博士)[\-－：:为]', text):
        tokens = re.split(r'[,，;；]', text)
        u_parts, g_parts = [], []
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            m = re.match(r'^(本科|专业硕士|研究生|硕士|博士)[\-－：:为]?(.*)', token)
            if m:
                prefix, rest = m.group(1), m.group(2).strip()
                if prefix == '本科':
                    u_parts.append(rest)
                else:
                    g_parts.append(rest)
        if u_parts or g_parts:
            return '、'.join(u_parts), '、'.join(g_parts)
    # Fallback to legacy semicolon logic (e.g., "本科：...;研究生：...")
    parts = []
    buf = ''
    depth = 0
    for ch in text:
        if ch == '（':
            depth += 1
        if ch == '）':
            depth -= 1
        if ch == ';' and depth == 0:
            parts.append(buf)
            buf = ''
        else:
            buf += ch
    parts.append(buf)
    sections = {}
    for p in parts:
        p = p.strip()
        if not p:
            continue
        m = re.match(r'^(本科|研究生)(?:[：:为])?(.*)', p)
        if m:
            sections[m.group(1)] = m.group(2).strip()
    return sections.get('本科', ''), sections.get('研究生', '')


def split_major(row, major_col='专业要求', xueli_col='学历要求'):
    text = row.get(major_col, '')
    xueli = str(row.get(xueli_col, ''))
    u, g = split_major_text(text)
    if u == '' and g == '':
        if '仅限本科' in xueli or xueli in ['本科', '大专或本科']:
            u = str(text)
        elif '硕士研究生' in xueli or '博士研究生' in xueli or '研究生' in xueli:
            g = str(text)
        elif '本科及以上' in xueli or '本科或硕士研究生' in xueli:
            bz = str(row.get('其他条件', ''))
            if '研究生所学专业' in bz and '本科或研究生' not in bz:
                g = str(text)
            elif '本科所学专业' in bz and '本科或研究生' not in bz:
                u = str(text)
            else:
                u = str(text)
                g = str(text)
        elif '大专' in xueli:
            pass
        else:
            u = str(text)
            g = str(text)
    return u, g


def clean_str(s):
    if s is None:
        return ''
    return str(s).replace('\n', ' ').replace('\r', ' ').replace('\xa0', ' ').replace('\u3000', ' ').strip()


def clean_major_str(s):
    s = clean_str(s)
    if s in ['——', '—', '--', '-', '无', '无限制', '不限', 'NaN', 'nan', '']:
        return ''
    return s


def parse_position_excel(fn, province='', source_url='', default_exam='', job_type='选调生'):
    if fn.endswith('.xlsx'):
        xls = pd.ExcelFile(fn, engine='calamine')
    else:
        xls = pd.ExcelFile(fn)
    all_rows = []
    for s in xls.sheet_names:
        df0 = pd.read_excel(xls, sheet_name=s, header=None, dtype=str)
        header_rows, multi = detect_header_info(df0)
        try:
            if multi:
                df = pd.read_excel(xls, sheet_name=s, header=header_rows, dtype=str)
                df.columns = flatten_multicolumn(df.columns)
            else:
                df = pd.read_excel(xls, sheet_name=s, header=header_rows[0], dtype=str)
        except Exception:
            df = pd.read_excel(xls, sheet_name=s, header=0, dtype=str)
        idx = map_columns(df.columns)
        # Forward fill merged cells for unit / location columns
        for key in ('单位名称', '工作地点'):
            if key in idx:
                col = df.columns[idx[key]]
                df[col] = df[col].ffill()
        # If we have separate undergraduate/graduate major columns, use them directly
        has_u_major = '本科生专业要求' in idx
        has_g_major = '研究生专业要求' in idx
        for _, r in df.iterrows():
            vals = {k: (r.iloc[v] if pd.notna(r.iloc[v]) else '') for k, v in idx.items()}
            if str(vals.get('职位名称', '')) + str(vals.get('专业要求', '')) + str(vals.get('单位名称', '')) + str(vals.get('本科生专业要求', '')) + str(vals.get('研究生专业要求', '')) == '':
                continue
            # skip header repeats or summary rows
            bad_names = ['职位名称', '选调职位', '岗位名称', '招录职位', '专业要求', '专业', '本科', '研究生', '招录单位']
            if str(vals.get('职位名称', '')) in bad_names and str(vals.get('专业要求', '')) in bad_names:
                continue
            if has_u_major and has_g_major:
                u = clean_major_str(str(vals.get('本科生专业要求', '')))
                g = clean_major_str(str(vals.get('研究生专业要求', '')))
                raw_major = str(vals.get('本科生专业要求', '')) + (' / ' + str(vals.get('研究生专业要求', '')) if vals.get('研究生专业要求') else '')
            else:
                u, g = split_major(vals, '专业要求', '学历要求')
                raw_major = str(vals.get('专业要求', ''))
            # Build degree/education info
            xueli = clean_str(vals.get('学历要求', ''))
            if not xueli:
                xueli = '本科及以上（定向选调）'
            # Special requirements
            spec_items = []
            for sk in ['政治面貌', '学位要求', '来源类别', '考试科目', '职称', '职业资格', '基层工作最低年限', '服务基层项目工作经历', '面试阶段专业测试', '其他条件', '招录高校范围', '面试比例', '联系电话']:
                if vals.get(sk):
                    spec_items.append(str(sk) + '：' + str(vals[sk]))
            spec = '；'.join(spec_items)
            code = str(vals.get('岗位代码', '')).strip()
            title = str(vals.get('职位名称', ''))
            intro = str(vals.get('职位简介', ''))
            job_name = clean_str((code + ' ' if code else '') + title + ('；' + intro if intro else ''))
            if not job_name:
                continue
            work_place = clean_str(vals.get('工作地点', ''))
            if not work_place and province:
                work_place = province
            all_rows.append({
                '工作类型': job_type,
                '考试/招聘类型': default_exam,
                '用人单位/系统': clean_str(province + (' ' + str(vals.get('单位名称', '')) if vals.get('单位名称') else '')),
                '岗位示例': job_name,
                '学历要求': xueli,
                '本科生专业要求': clean_str(u),
                '研究生专业要求': clean_str(g),
                '考试/招聘形式': '笔试+面试',
                '报名时间': '',
                '笔试/考试时间': '',
                '特殊要求': clean_str(spec),
                '工作地点': work_place,
                '信息来源': source_url,
                '备注': '',
                '专业要求（原始）': clean_str(raw_major)
            })
    return pd.DataFrame(all_rows)


def download_file(url, out_dir):
    r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=120)
    r.raise_for_status()
    fname = None
    cd = r.headers.get('content-disposition', '')
    if 'filename=' in cd:
        fname = re.findall('filename="?([^"]+)"?', cd)
        if fname:
            fname = fname[0]
    if not fname:
        from urllib.parse import unquote, urlparse
        fname = unquote(os.path.basename(urlparse(url).path))
    if not fname:
        fname = 'download'
    path = os.path.join(out_dir, fname)
    with open(path, 'wb') as f:
        f.write(r.content)
    return path


def extract_zip(zip_path, out_dir, prefix='extract'):
    """Extract zip to out_dir using safe filenames. Returns list of extracted paths."""
    extracted = []
    seen = set()
    counter = 1
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.filename.endswith('/'):
                continue
            # determine extension from original filename (when possible)
            ext = os.path.splitext(info.filename)[1].lower()
            if not ext:
                ext = ''
            # use a safe unique filename
            safe = f"{prefix}_{counter:03d}{ext}"
            while safe in seen:
                counter += 1
                safe = f"{prefix}_{counter:03d}{ext}"
            seen.add(safe)
            dest = os.path.join(out_dir, safe)
            with z.open(info) as src, open(dest, 'wb') as dst:
                dst.write(src.read())
            extracted.append(dest)
            counter += 1
    return extracted


def crawl_xds_summary():
    url = 'https://www.jingjia.org/xds/526923.html'
    r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
    r.encoding = 'utf-8'
    soup = BeautifulSoup(r.text, 'html.parser')
    rows = []
    for table in soup.find_all('table'):
        for tr in table.find_all('tr'):
            tds = tr.find_all('td')
            if len(tds) >= 4:
                cells = [td.get_text(strip=True) for td in tds]
                if cells[0] == '省份':
                    continue
                links = [a.get('href') for a in tr.find_all('a') if a.get('href')]
                rows.append({
                    '省份': cells[0],
                    '招录人数': cells[2] if len(cells) > 2 else '',
                    '报名时间': cells[3] if len(cells) > 3 else '',
                    '笔试时间': cells[4] if len(cells) > 4 else '',
                    '笔试内容': cells[5] if len(cells) > 5 else '',
                    '成绩查询': cells[6] if len(cells) > 6 else '',
                    'detail_url': links[0] if links else ''
                })
    return rows


def _score_source_url(u, detail_url=''):
    """Score a candidate official URL; higher is better."""
    u_lower = u.lower()
    # banned national/irrelevant domains
    banned = ['scs.gov.cn', 'moe.gov.cn', '12371.gov.cn', 'miit.gov.cn', 'beian.miit.gov.cn',
              'www.gov.cn', 'cnzz.net', 'baidu.com', 'jingjia.org', 'job.mohrss.gov.cn']
    if any(b in u_lower for b in banned):
        return -100
    if urlparse(u).netloc.lower() in ('',):
        return -100
    score = 0
    if '.gov.cn' in u_lower:
        score += 5
    elif '.org.cn' in u_lower or '.edu.cn' in u_lower:
        score += 3
    # prefer official/selective keywords
    if any(k in u_lower for k in ['xds', 'xuan', 'diaosheng', 'gwy', 'tzgg', 'rsks', 'zzb', 'dj', 'gwykl']):
        score += 3
    if re.search(r'/(2025|2026|2027)/', u_lower):
        score += 2
    if re.search(r'\.(xlsx|xls|zip|docx|doc|rar|pdf)$', u, re.I):
        score -= 5
    return score


def extract_official_and_files(detail_url):
    r = requests.get(detail_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
    r.encoding = 'utf-8'
    text = r.text
    urls = re.findall(r'https?://[^\s"<>\'\)]+', text)
    urls = list(dict.fromkeys(urls))
    official = []
    file_urls = []
    for u in urls:
        if any(x in u.lower() for x in ['.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.svg', '.webp', '.ico']):
            continue
        if re.search(r'\.(xlsx|xls|zip|docx|doc|rar)$', u, re.I):
            file_urls.append(u)
        else:
            official.append(u)
    # score and pick best official candidate
    candidates = [(u, _score_source_url(u, detail_url)) for u in official]
    candidates = [c for c in candidates if c[1] > 0]
    candidates.sort(key=lambda x: x[1], reverse=True)
    official_url = candidates[0][0] if candidates else ''
    file_urls = list(dict.fromkeys(file_urls))
    return official_url, file_urls
