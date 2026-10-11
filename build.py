#!/usr/bin/env python3
"""
Сборка сайтов: из папки sites/<имя>/ получается один самодостаточный файл out/<имя>.html.
Шрифты, стили, скрипты и данные вшиваются внутрь, поэтому страница открывается без интернета
и выкладывается на любой хостинг одним файлом.

  python3 build.py            собрать все сайты из папки sites/
  python3 build.py asmat      собрать один сайт

Что лежит в папке сайта:
  index.html   разметка. В ней:
                 <!--@fonts-->                 сюда встанут шрифты из fonts.json
                 <!--@data-->                  сюда встанет data.json как window.DATA
                 <!--@include art/x.svg-->     вставить файл как есть
                 <link rel="stylesheet" href="style.css">     будет вшит
                 <script src="../../shared/core.js"></script> будет вшит
                 <script src="app.js"></script>               будет вшит
  style.css    оформление
  app.js       поведение
  data.json    тексты, меню и цены на трёх языках
  fonts.json   какие шрифты из папки fonts/ нужны сайту
"""
import base64
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SITES = ROOT / "sites"
FONTS = ROOT / "fonts"
OUT = ROOT / "out"
LANGS = ("az", "ru", "en")


class BuildError(Exception):
    pass


def read(path):
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise BuildError("Не найден файл: %s" % path.relative_to(ROOT))


def load_json(path):
    text = read(path)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        line = text.splitlines()[e.lineno - 1].strip() if e.lineno - 1 < len(text.splitlines()) else ""
        raise BuildError(
            "Ошибка в файле %s, строка %d, позиция %d: %s\n    %s\n"
            "Чаще всего это лишняя или пропущенная запятая, либо кавычка."
            % (path.relative_to(ROOT), e.lineno, e.colno, e.msg, line[:120]))


def check_data(node, path, problems):
    """Каждый текст должен быть на трёх языках, каждая цена должна быть числом."""
    if isinstance(node, dict):
        keys = set(node.keys())
        if keys & set(LANGS) and keys <= set(LANGS) | {"_"}:
            for code in LANGS:
                v = node.get(code)
                if not isinstance(v, str) or not v.strip():
                    problems.append("%s: нет текста на языке «%s»" % (path, code))
            return
        for k, v in node.items():
            here = "%s.%s" % (path, k) if path else k
            if k in ("price", "glass", "bottle") and v is not None and not isinstance(v, (int, float)):
                problems.append("%s: цена должна быть числом, например 12 или 6.5 (сейчас %r)" % (here, v))
            if k == "prices" and isinstance(v, dict):
                for kk, vv in v.items():
                    if vv is not None and not isinstance(vv, (int, float)):
                        problems.append("%s.%s: цена должна быть числом (сейчас %r)" % (here, kk, vv))
            check_data(v, here, problems)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            label = ""
            if isinstance(v, dict):
                nm = v.get("name") or v.get("title") or v.get("id")
                if isinstance(nm, dict):
                    nm = nm.get("ru") or nm.get("az") or nm.get("en")
                if isinstance(nm, str):
                    label = " «%s»" % nm[:40]
            check_data(v, "%s[%d]%s" % (path, i + 1, label), problems)


def check_menu(data, problems):
    """Меню с парами (кухня + вино): у каждой позиции свой id и цена,
    а каждая пара ссылается на существующее блюдо и на вино с ценой за бокал.
    Без этой проверки удалённое блюдо или вино из пары ломает страницу у гостей."""
    if not isinstance(data, dict) or "pairs" not in data:
        return

    def label(it):
        nm = it.get("name")
        if isinstance(nm, dict):
            nm = nm.get("ru") or nm.get("az") or nm.get("en")
        return str(nm or it.get("id") or "?").split(" | ")[0][:40].rstrip()

    items = {}
    for part, title in (("kitchen", "кухня"), ("bar", "вино")):
        sections = (data.get(part) or {}).get("sections") or []
        if not sections:
            problems.append("%s: нет ни одного раздела" % part)
        seen_sections = set()
        for si, s in enumerate(sections, 1):
            where = "%s, раздел %d" % (title, si)
            sid = s.get("id")
            if not isinstance(sid, str) or not sid.strip():
                problems.append("%s: нет id раздела" % where)
            elif sid in seen_sections:
                problems.append("%s: id раздела «%s» уже занят другим разделом" % (where, sid))
            seen_sections.add(sid)
            for ii, it in enumerate(s.get("items") or [], 1):
                iid = it.get("id")
                if not isinstance(iid, str) or not iid.strip():
                    problems.append("%s, позиция %d «%s»: нет id" % (where, ii, label(it)))
                    continue
                if iid in items:
                    problems.append("id «%s» встречается дважды («%s» и «%s»): у каждой позиции свой id"
                                    % (iid, label(items[iid][1]), label(it)))
                items[iid] = (part, it)
                if part == "kitchen" and it.get("price") is None:   # цену-текст уже поймала check_data
                    problems.append("кухня, «%s» (id %s): нет цены price" % (label(it), iid))
                if part == "bar":
                    vint = it.get("vint") or []
                    if it.get("glass") is None and it.get("bottle") is None and not vint:
                        problems.append("вино «%s» (id %s): нет ни одной цены: glass, bottle или vint"
                                        % (label(it), iid))
                    for v in vint:
                        if not isinstance(v, dict) or "y" not in v or v.get("bottle") is None:
                            problems.append("вино «%s» (id %s): в vint у каждого года нужны y и bottle"
                                            % (label(it), iid))

    pairs = data.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        problems.append("pairs: нужна хотя бы одна пара «блюдо + вино»")
        return
    used = {}
    for n, p in enumerate(pairs, 1):
        where = "pairs, пара %d" % n
        dish, drink = p.get("dish"), p.get("drink")
        d, w = items.get(dish), items.get(drink)
        if not d or d[0] != "kitchen":
            problems.append("%s: на кухне нет блюда с id «%s»" % (where, dish))
        if not w or w[0] != "bar":
            problems.append("%s: в винной карте нет вина с id «%s»" % (where, drink))
        elif w[1].get("glass") is None:
            problems.append("%s: у вина «%s» (id %s) нет цены за бокал glass, а пара считается по бокалу"
                            % (where, label(w[1]), drink))
        if "why" not in p:
            problems.append("%s: нет пояснения why на трёх языках" % where)
        for x in (dish, drink):
            if x in used:
                problems.append("%s: «%s» уже стоит в паре %d. У блюда и у вина может быть только одна пара"
                                % (where, x, used[x]))
            else:
                used[x] = n


def font_css(site_dir):
    spec_path = site_dir / "fonts.json"
    spec = load_json(spec_path) if spec_path.exists() else []
    faces = []

    def face(family, file, weight="400", style="normal", urange=None):
        p = FONTS / file
        if not p.exists():
            raise BuildError("В fonts.json указан файл %s, но в папке fonts/ его нет." % file)
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        fmt = "woff2" if file.endswith(".woff2") else "woff"
        css = '@font-face{font-family:"%s";src:url(data:font/%s;base64,%s) format("%s");font-weight:%s;font-style:%s;font-display:swap' % (
            family, fmt, b64, fmt, weight, style)
        if urange:
            css += ";unicode-range:%s" % urange
        return css + "}"

    # Знак маната есть не во всех шрифтах. Отдельный маленький шрифт подставляет только его.
    faces.append(face("Manat", "manat.woff", "300 900", "normal", "U+20BC"))
    for f in spec:
        faces.append(face(f["family"], f["file"], str(f.get("weight", "400")), f.get("style", "normal"), f.get("range")))
    return "<style>\n" + "\n".join(faces) + "\n</style>"


def build_site(name):
    site = SITES / name
    if not (site / "index.html").exists():
        raise BuildError("Нет сайта «%s»: не найден sites/%s/index.html" % (name, name))
    html = read(site / "index.html")

    # данные
    data_path = site / "data.json"
    if data_path.exists():
        data = load_json(data_path)
        problems = []
        check_data(data, "", problems)
        check_menu(data, problems)
        if problems:
            raise BuildError("В данных %s есть ошибки:\n  - %s" % (
                data_path.relative_to(ROOT), "\n  - ".join(problems[:30])))
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        html = html.replace("<!--@data-->", "<script>window.DATA=%s;</script>" % blob)

    # шрифты
    if "<!--@fonts-->" in html:
        html = html.replace("<!--@fonts-->", font_css(site))

    # вставки файлов
    def include(m):
        return read((site / m.group(1).strip()).resolve())
    html = re.sub(r"<!--@include\s+([^>]+?)-->", include, html)

    # стили
    def css(m):
        href = m.group(1)
        if re.match(r"^(https?:)?//", href):
            return m.group(0)
        return "<style>\n%s\n</style>" % read((site / href).resolve())
    html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', css, html)

    # скрипты
    def js(m):
        src = m.group(1)
        if re.match(r"^(https?:)?//", src):
            return m.group(0)
        return "<script>\n%s\n</script>" % read((site / src).resolve()).replace("</script", "<\\/script")
    html = re.sub(r'<script\s+src="([^"]+)"\s*>\s*</script>', js, html)

    warn = []
    for m in re.finditer(r'(?:src|href)="(https?://[^"]+\.(?:css|js|woff2?|ttf|png|jpe?g|svg|webp))"', html):
        warn.append("внешний файл %s: без интернета он не загрузится" % m.group(1))
    if "<!--@" in html:
        warn.append("в разметке остались необработанные вставки <!--@…-->")

    OUT.mkdir(exist_ok=True)
    target = OUT / ("%s.html" % name)
    target.write_text(html, encoding="utf-8")
    print("  %-12s %6.0f КБ  → out/%s.html" % (name, target.stat().st_size / 1024, name))
    for w in warn:
        print("      внимание: " + w)


def main():
    names = sys.argv[1:] or sorted(p.name for p in SITES.iterdir() if (p / "index.html").exists())
    if not names:
        print("В папке sites/ пока нет сайтов.")
        return
    failed = False
    for name in names:
        try:
            build_site(name)
        except BuildError as e:
            failed = True
            print("  %-12s ОШИБКА\n%s" % (name, e))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
