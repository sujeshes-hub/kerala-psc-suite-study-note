#!/usr/bin/env python3
"""
Kerala PSC Study Suite — convert raw LaTeX / ASCII math into native HTML.

The site must work offline, so no MathJax or KaTeX.  This rewrites, in the
*text* of a page only (never inside tags, attributes, <script>, <style>,
<pre> or <code> examples):

    $a_n = a + (n-1)d$      ->  a<sub>n</sub> = a + (n-1)d
    $b = \\sqrt{ac}$         ->  b = √(ac)
    $\\frac{a+c}{2}$         ->  a stacked fraction (CSS .kfrac)
    $\\times2+n$             ->  ×2 + n
    H2O / CO2 / NH3         ->  H<sub>2</sub>O / CO<sub>2</sub> / NH<sub>3</sub>
    F_c, E_g, a^k           ->  F<sub>c</sub>, E<sub>g</sub>, a<sup>k</sup>

Only spans that actually look like mathematics are touched: an Excel reference
like $A$1 or the $ placeholder in a coding question must survive untouched.

    python tools/fix_math.py            # dry run: report what would change
    python tools/fix_math.py --apply    # write, after backing every file up
"""
import os
import re
import shutil
import sys
import time
from collections import Counter, defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = time.strftime("%Y%m%d-%H%M%S")
BACKUP = os.path.join(ROOT, "tools", "_backup", STAMP)

TAG = re.compile(r"</?[a-zA-Z!][^>]*>", re.S)
SKIP_TEXT_INSIDE = {"script", "style", "code", "pre", "textarea", "title", "option"}

SYMBOLS = {
    r"\times": "×", r"\div": "÷", r"\pm": "±", r"\mp": "∓", r"\cdot": "·",
    r"\le": "≤", r"\leq": "≤", r"\ge": "≥", r"\geq": "≥", r"\ne": "≠",
    r"\neq": "≠", r"\approx": "≈", r"\equiv": "≡", r"\infty": "∞",
    r"\to": "→", r"\rightarrow": "→", r"\Rightarrow": "⇒", r"\implies": "⇒",
    r"\leftrightarrow": "↔", r"\dots": "…", r"\ldots": "…", r"\cdots": "…",
    r"\sum": "Σ", r"\prod": "∏", r"\degree": "°", r"\%": "%", r"\$": "$",
    r"\pi": "π", r"\theta": "θ", r"\alpha": "α", r"\beta": "β", r"\gamma": "γ",
    r"\delta": "δ", r"\Delta": "Δ", r"\lambda": "λ", r"\mu": "μ", r"\sigma": "σ",
    r"\Sigma": "Σ", r"\omega": "ω", r"\Omega": "Ω", r"\rho": "ρ", r"\phi": "φ",
    r"\sin": "sin", r"\cos": "cos", r"\tan": "tan", r"\log": "log",
    r"\left": "", r"\right": "", r"\quad": " ", r"\qquad": " ",
    r"\,": " ", r"\;": " ", r"\:": " ", r"\!": "",
    r"\{": "{", r"\}": "}", r"\_": "_", r"\&": "&amp;", r"\#": "#",
    r"\\": " ", r"\ ": " ",
}

CHEM = re.compile(
    r"(?<![\w><])(H2SO4|H2SO3|H2CO3|C6H12O6|C2H5OH|CH3COOH|KMnO4|NaHCO3|Na2CO3"
    r"|CaCO3|CuSO4|Fe2O3|Al2O3|ZnSO4|PbO2|HNO3|H2O2|H2O|CO2|SO2|NO2|NH3|CH4"
    r"|Cl2|O3|P4|S8|O2|N2|H2)(?![.\w)])")
UNIT = re.compile(r"(?<![\w/.])(km|cm|mm|dm|kg|m|g)(2|3)(?![0-9\w])")
BARE_SUB = re.compile(r"(?<![\w$])([A-Za-z]{1,3})_(?:\{(\w+)\}|([^\W\d]\w{0,12}))")
BARE_SUP = re.compile(r"(?<![\w$])([A-Za-z0-9\)\]])\^(?:\{([^{}]+)\}|(-?\w))")
SQRT_CALL = re.compile(r"\bsqrt\s*\(([^()]*)\)")
# "4 x 14" is multiplication; "20x" (no space before x) is algebraic 20·x.
MULT_X = re.compile(r"(?<=\d)[ \t]+x[ \t]+(?=\d)")

MATH_ONLY = re.compile(
    r"^[\sA-Za-z0-9+\-*/^_=<>()\[\]{}.,:;!?|'\"\\%×÷±√π∞°≤≥≠≈·…→←⇒⇔∑$]*$")
EXCEL_REF = re.compile(r"^\s*[A-Z]{1,3}\d{0,4}\s*$")
# Absolute / mixed spreadsheet references: $A$1, $A1, A$1.
EXCEL_ABS = re.compile(r"\$[A-Za-z]{1,3}\$?\d{1,5}(?![\w])|(?<![\w])\$?[A-Za-z]{1,3}\$\d{1,5}(?![\w])")

# SVG <text> cannot hold <sup>/<sub>, so inside a diagram we use Unicode instead.
SUP_MAP = dict(zip("0123456789+-=()ni", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"))
SUB_MAP = {"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅",
           "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋",
           "=": "₌", "(": "₍", ")": "₎", "a": "ₐ", "e": "ₑ", "h": "ₕ",
           "i": "ᵢ", "j": "ⱼ", "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ",
           "o": "ₒ", "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
           "v": "ᵥ", "x": "ₓ"}


def to_unicode(text, table):
    out = []
    for ch in text:
        if ch not in table:
            return None
        out.append(table[ch])
    return "".join(out)

FRACTION_CSS = (
    "<style>/* inline fractions for offline math (no MathJax) */\n"
    ".kfrac{display:inline-flex;flex-direction:column;vertical-align:middle;"
    "text-align:center;line-height:1.08;margin:0 .18em;font-size:.95em}\n"
    ".kfrac>.kfnum{padding:0 .25em;border-bottom:1px solid currentColor}\n"
    ".kfrac>.kfden{padding:0 .25em}\n</style>\n"
)

stats = Counter()
review = []


KEEP_TAGS = re.compile(r"</?(?:sup|sub|strong|b|i|em|span)(?:\s[^>]*)?>")


def esc_text(s):
    """Escape literal &, <, > but never break an entity that is already there."""
    s = re.sub(r"&(?![a-zA-Z#][a-zA-Z0-9]*;)", "&amp;", s)
    return s.replace("<", "&lt;").replace(">", "&gt;")


def esc(s):
    return esc_text(s)


def esc_keep_markup(s):
    """Escape stray characters while keeping the tags this tool generated."""
    out, pos = [], 0
    for m in KEEP_TAGS.finditer(s):
        out.append(esc_text(s[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(esc_text(s[pos:]))
    return "".join(out)


def read_group(s, i):
    """s[i] == '{' -> (balanced inner text, index after '}')."""
    depth, start = 1, i + 1
    j = start
    while j < len(s) and depth:
        if s[j] == "\\":
            j += 2
            continue
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if not depth:
                return s[start:j], j + 1
        j += 1
    stats["unbalanced_brace"] += 1
    return s[start:], len(s)


def read_arg(s, i):
    """Read one macro argument: {group}, \\command, or a single character."""
    while i < len(s) and s[i] == " ":
        i += 1
    if i >= len(s):
        return "", i
    if s[i] == "{":
        return read_group(s, i)
    if s[i] == "\\":
        m = re.match(r"\\[a-zA-Z]+|\\.", s[i:])
        return m.group(0), i + len(m.group(0))
    return s[i], i + 1


def render(s, depth=0):
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            m = re.match(r"\\[a-zA-Z]+|\\.", s[i:])
            if not m:
                i += 1
                continue
            cmd = m.group(0)
            i += len(cmd)
            name = cmd[1:]
            if name in ("frac", "dfrac", "tfrac"):
                a, i = read_arg(s, i)
                b, i = read_arg(s, i)
                stats["frac"] += 1
                out.append('<span class="kfrac"><span class="kfnum">%s</span>'
                           '<span class="kfden">%s</span></span>' % (render(a, depth + 1), render(b, depth + 1)))
            elif name == "sqrt":
                a, i = read_arg(s, i)
                inner = render(a, depth + 1)
                plain = re.sub(r"<[^>]+>", "", inner)
                stats["sqrt"] += 1
                out.append(f"√({inner})" if len(plain) > 1 else f"√{inner}")
            elif name == "mathbf":
                a, i = read_arg(s, i)
                out.append("<strong>%s</strong>" % render(a, depth + 1))
            elif name == "text":
                a, i = read_arg(s, i)
                out.append(esc(a))
            elif cmd in SYMBOLS:
                out.append(SYMBOLS[cmd])
            else:
                stats["unknown_latex_cmd"] += 1
                stats["cmd:" + cmd] += 1
                if cmd not in review:
                    review.append(cmd)
            continue
        if c == "^":
            a, i = read_arg(s, i + 1)
            out.append("<sup>%s</sup>" % render(a, depth + 1))
            continue
        if c == "_":
            a, i = read_arg(s, i + 1)
            out.append("<sub>%s</sub>" % render(a, depth + 1))
            continue
        if c == "{":
            a, i = read_group(s, i)
            out.append(render(a, depth + 1))
            continue
        if c == "}":
            i += 1
            continue
        out.append(esc(c))
        i += 1
    return "".join(out)


def convert_dollar(text):
    def repl(m):
        inner = m.group(1)
        after = text[m.end():m.end() + 1]
        if EXCEL_REF.match(inner) and after.isdigit():
            return m.group(0)          # $A$1 / $B$2 spreadsheet references
        looks_like_math = (
            "\\" in inner
            or (MATH_ONLY.match(inner) and re.search(r"[A-Za-z0-9]", inner))
            or re.fullmatch(r"[+\-*/=<>±×÷]\s*[+\-]?\d*(?:\.\d+)?", inner.strip())
            or re.fullmatch(r"[A-Za-z][\w]{0,2}", inner.strip())
        )
        if not looks_like_math:
            return m.group(0)
        stats["dollar_span"] += 1
        return render(inner)

    return re.sub(r"\$([^$\n]{1,300}?)\$", repl, text)


def convert_bare(text):
    def chem(m):
        stats["chem"] += 1
        return re.sub(r"(\d+)", r"<sub>\1</sub>", m.group(1))

    def unit(m):
        stats["unit_power"] += 1
        return f"{m.group(1)}<sup>{m.group(2)}</sup>"

    def sub(m):
        stats["bare_sub"] += 1
        return f"{m.group(1)}<sub>{m.group(2) or m.group(3)}</sub>"

    def sup(m):
        stats["bare_sup"] += 1
        return f"{m.group(1)}<sup>{m.group(2) or m.group(3)}</sup>"

    def sqrt(m):
        stats["sqrt_call"] += 1
        inner = m.group(1).replace("*", "×")
        return f"√({inner})" if len(inner) > 1 else f"√{inner}"

    text = CHEM.sub(chem, text)
    text = UNIT.sub(unit, text)
    text = SQRT_CALL.sub(sqrt, text)
    text = re.sub(r"\\text\{([^{}]*)\}", lambda m: esc(m.group(1)), text)
    text = BARE_SUB.sub(sub, text)
    text = BARE_SUP.sub(sup, text)
    text, n = MULT_X.subn(" × ", text)
    if n:
        stats["times_sign"] += n
    return text


def convert_svg_text(text):
    """Inside <svg><text> the portable options are Unicode or <tspan>."""
    def sup(m):
        exp = m.group(2) or m.group(3)
        uni = to_unicode(exp, SUP_MAP)
        if uni is not None:
            stats["svg_sup"] += 1
            return m.group(1) + uni
        # no Unicode form (e.g. uppercase): shift the baseline with tspan
        stats["svg_sup_tspan"] += 1
        return (f'{m.group(1)}<tspan baseline-shift="super" font-size="0.72em">'
                f'{exp}</tspan>')

    def sub(m):
        idx = m.group(2) or m.group(3)
        uni = to_unicode(idx, SUB_MAP)
        if uni is not None:
            stats["svg_sub"] += 1
            return m.group(1) + uni
        stats["svg_sub_tspan"] += 1
        return (f'{m.group(1)}<tspan baseline-shift="sub" font-size="0.72em">'
                f'{idx}</tspan>')

    def chem(m):
        stats["svg_chem"] += 1
        return "".join(SUB_MAP.get(c, c) if c.isdigit() else c for c in m.group(1))

    text = CHEM.sub(chem, text)
    text = BARE_SUP.sub(sup, text)
    text = BARE_SUB.sub(sub, text)
    return re.sub(r"&(?![a-zA-Z#][a-zA-Z0-9]*;)", "&amp;", text)


def fix_text(text):
    # Protect spreadsheet references ($A$1, $A1, A$1) before looking for $...$
    # math, otherwise "$A1 / A$1" reads as a math span and loses its dollars.
    held = []

    def hold(m):
        held.append(m.group(0))
        return f"\x06{len(held) - 1}\x07"

    text = EXCEL_ABS.sub(hold, text)

    text = convert_dollar(text)
    text = convert_bare(text)
    text = esc_keep_markup(text)
    if text.count("$") % 2 and re.search(r"[\\^_]", text):
        # A $...$ pair straddled an HTML tag, so the halves sit in different text
        # nodes.  Only ever unwrap when the text really is LaTeX (a \command or
        # ^/_) — a lone $ may be currency, an Excel $A$1, or a $ operator in a
        # coding question, and deleting it would corrupt the question.
        stats["dollar_crossed_tag"] += 1
        text = text.replace("$", "")
    for i, value in enumerate(held):
        text = text.replace(f"\x06{i}\x07", value)
    return text


def process(html_text):
    parts, pos = [], 0
    for m in TAG.finditer(html_text):
        if m.start() > pos:
            parts.append((False, html_text[pos:m.start()]))
        parts.append((True, m.group(0)))
        pos = m.end()
    if pos < len(html_text):
        parts.append((False, html_text[pos:]))

    out, skip, svg = [], 0, 0
    for is_tag, chunk in parts:
        if is_tag:
            out.append(chunk)
            name = re.match(r"([a-zA-Z0-9]+)", chunk.lstrip("</").lower())
            name = name.group(1) if name else ""
            closing = chunk.lstrip().startswith("</")
            selfclosing = chunk.rstrip().endswith("/>")
            if name in SKIP_TEXT_INSIDE:
                if closing:
                    skip = max(0, skip - 1)
                elif not selfclosing:
                    skip += 1
            elif name == "svg":
                if closing:
                    svg = max(0, svg - 1)
                elif not selfclosing:
                    svg += 1
            continue
        if skip:
            out.append(chunk)
        elif svg:
            out.append(convert_svg_text(chunk))
        else:
            out.append(fix_text(chunk))
    result = "".join(out)

    if '<span class="kfrac"' in result and ".kfrac" not in result:
        result = result.replace("</head>", FRACTION_CSS + "</head>", 1)
    return result


def main():
    apply = "--apply" in sys.argv
    changed = []

    for dp, dn, fn in os.walk(os.path.join(ROOT, "topics")):
        for name in sorted(fn):
            if not name.lower().endswith(".html"):
                continue
            path = os.path.join(dp, name)
            with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
                original = fh.read()
            updated = process(original)
            if updated == original:
                continue
            changed.append(os.path.relpath(path, ROOT).replace("\\", "/"))
            if apply:
                dest = os.path.join(BACKUP, os.path.relpath(path, ROOT))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(path, dest)
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(updated)

    print("=" * 74)
    print("MATH FORMATTING REPAIR — " + ("APPLIED" if apply else "DRY RUN"))
    print("=" * 74)
    print(f"pages changed : {len(changed)}")
    for cat, count in stats.most_common():
        print(f"  {cat:<22} {count}")
    if review:
        print(f"\nfor review ({len(review)}):")
        for item in review[:15]:
            print("   " + item)
    if changed:
        print("\n" + "\n".join("  " + c for c in changed[:15]))
        if len(changed) > 15:
            print(f"  ... and {len(changed) - 15} more")
    if apply and changed:
        print(f"\nbackups: {os.path.relpath(BACKUP, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
