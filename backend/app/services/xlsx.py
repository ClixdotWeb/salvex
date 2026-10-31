"""
Minimal, safe reader and writer for Excel .xlsx files, built only on the standard library.

An .xlsx file is a zip of XML parts. Reading needs only the first worksheet's cell text, so this avoids a third-party
dependency. Safety: the zip size and number of parts are capped, each part is read with a size limit (zip bombs), and
any XML with a DOCTYPE is refused (entity tricks); the bundled expat (2.4+) also blocks entity expansion attacks.
"""
import io
import re
import zipfile
from datetime import datetime, timedelta
from typing import Optional
from xml.etree import ElementTree
from xml.sax.saxutils import escape

MAX_PARTS = 200
MAX_PART_BYTES = 40 * 1024 * 1024          # uncompressed size of one XML part
MAX_ROWS = 2000
MAX_COLUMNS = 60

_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_CELL_REF = re.compile(r"^([A-Z]{1,3})(\d+)$")
_EXCEL_EPOCH = datetime(1899, 12, 30)


class XlsxError(ValueError):
    """The file is not a readable .xlsx workbook (message is safe to show)."""


def looks_like_xlsx(data: bytes) -> bool:
    return data[:4] == b"PK\x03\x04"


def _part(book: zipfile.ZipFile, name: str) -> Optional[bytes]:
    try:
        info = book.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_PART_BYTES:
        raise XlsxError("The Excel file is too large. Keep one sheet with the vehicles only.")
    with book.open(info) as fh:
        data = fh.read(MAX_PART_BYTES + 1)
    if len(data) > MAX_PART_BYTES:
        raise XlsxError("The Excel file is too large. Keep one sheet with the vehicles only.")
    if b"<!DOCTYPE" in data[:2048].upper() or b"<!ENTITY" in data.upper():
        raise XlsxError("The Excel file could not be read.")
    return data


def _xml(data: bytes) -> ElementTree.Element:
    try:
        return ElementTree.fromstring(data)
    except ElementTree.ParseError:
        raise XlsxError("The Excel file could not be read. Save it again from Excel and retry.") from None


def _column_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _first_sheet_path(book: zipfile.ZipFile) -> str:
    workbook, rels = _part(book, "xl/workbook.xml"), _part(book, "xl/_rels/workbook.xml.rels")
    if workbook and rels:
        sheet = _xml(workbook).find("m:sheets/m:sheet", _NS)
        if sheet is not None:
            rel_id = sheet.get(f"{{{_REL_NS}}}id")
            for rel in _xml(rels):
                if rel.get("Id") == rel_id and rel.get("Target"):
                    target = rel.get("Target").lstrip("/")
                    return target if target.startswith("xl/") else f"xl/{target}"
    return "xl/worksheets/sheet1.xml"


def _text(node: ElementTree.Element) -> str:
    return "".join(t.text or "" for t in node.iter(f"{{{_NS['m']}}}t"))


def _number(text: str) -> str:
    """Excel stores 2019 as "2019" but sometimes 48210.0 or 1E+5; give back what a person typed."""
    try:
        value = float(text)
    except ValueError:
        return text
    if value.is_integer() and abs(value) < 1e15:
        return str(int(value))
    return text


def read_first_sheet(data: bytes) -> list[list[str]]:
    """Return the first worksheet as rows of cell text (empty cells are "")."""
    try:
        book = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise XlsxError("The file is not a valid Excel (.xlsx) file.") from None
    with book:
        if len(book.infolist()) > MAX_PARTS:
            raise XlsxError("The Excel file could not be read.")
        shared: list[str] = []
        strings = _part(book, "xl/sharedStrings.xml")
        if strings:
            shared = [_text(si) for si in _xml(strings).findall("m:si", _NS)]
        sheet = _part(book, _first_sheet_path(book))
        if sheet is None:
            raise XlsxError("The Excel file has no worksheet.")
        rows: dict[int, dict[int, str]] = {}
        for row in _xml(sheet).iterfind("m:sheetData/m:row", _NS):
            for cell in row.findall("m:c", _NS):
                match = _CELL_REF.match(cell.get("r") or "")
                if not match:
                    continue
                col, number = _column_index(match.group(1)), int(match.group(2))
                if col >= MAX_COLUMNS:
                    continue
                if number > MAX_ROWS + 1:
                    raise XlsxError(f"The sheet has more than {MAX_ROWS} rows.")
                kind = cell.get("t")
                value_node = cell.find("m:v", _NS)
                raw = value_node.text if value_node is not None and value_node.text else ""
                if kind == "s":
                    try:
                        value = shared[int(raw)]
                    except (ValueError, IndexError):
                        value = ""
                elif kind == "inlineStr":
                    inline = cell.find("m:is", _NS)
                    value = _text(inline) if inline is not None else ""
                elif kind == "b":
                    value = "Yes" if raw == "1" else "No"
                elif kind in ("str", "e"):
                    value = raw if kind == "str" else ""
                else:
                    value = _number(raw)
                rows.setdefault(number, {})[col] = value.strip()
    if not rows:
        return []
    out = []
    for number in range(1, max(rows) + 1):
        cells = rows.get(number, {})
        out.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
    return out


def excel_serial_to_datetime(text: str) -> Optional[datetime]:
    """A date/time cell arrives as a day count (e.g. 46323.4166 = 28 Oct 2026 10:00)."""
    try:
        value = float(text)
    except ValueError:
        return None
    if not 30000 < value < 80000:                       # 1982 .. 2119: anything else is not a date
        return None
    return (_EXCEL_EPOCH + timedelta(days=value)).replace(second=0, microsecond=0)


# ---------------------------------------------------------------------------- writing (the template)
def _col_letter(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _validations_xml(validations: list[tuple[int, list[str]]], first_row: int, last_row: int) -> str:
    """Drop-down lists (Excel "data validation") for whole columns: [(column index, allowed values)]."""
    if not validations:
        return ""
    parts = []
    for col, values in validations:
        letter = _col_letter(col)
        allowed = escape(",".join(values).replace('"', "'"))
        parts.append(f'<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Not in the list" '
                     f'error="Choose a value from the list." sqref="{letter}{first_row}:{letter}{last_row}">'
                     f'<formula1>"{allowed}"</formula1></dataValidation>')
    return f'<dataValidations count="{len(parts)}">{"".join(parts)}</dataValidations>'


def _sheet_xml(rows: list[list[str]], widths: list[int], header_rows: int,
               validations: Optional[list[tuple[int, list[str]]]] = None, last_row: int = 501) -> str:
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    body = []
    for r, row in enumerate(rows, start=1):
        cells = []
        for c, value in enumerate(row):
            if value == "":
                continue
            style = ' s="1"' if r <= header_rows else ""
            cells.append(f'<c r="{_col_letter(c)}{r}" t="inlineStr"{style}><is><t xml:space="preserve">{escape(str(value))}</t></is></c>')
        body.append(f'<row r="{r}">{"".join(cells)}</row>')
    freeze = ('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
              '</sheetView></sheetViews>') if header_rows else ""
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<worksheet xmlns="{_NS["m"]}">{freeze}<cols>{cols}</cols><sheetData>{"".join(body)}</sheetData>'
            f'{_validations_xml(validations or [], header_rows + 1, last_row)}</worksheet>')


def write_workbook(sheets: list[tuple]) -> bytes:
    """sheets: (name, rows, column widths, number of bold header rows[, drop-down lists]). Every cell is text.
    Drop-down lists: [(column index, allowed values)], applied to the rows under the heading."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        overrides = "".join(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for i in range(1, len(sheets) + 1))
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   f'{overrides}</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '</Relationships>')
        names = "".join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, *_rest) in enumerate(sheets, start=1))
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   f'<workbook xmlns="{_NS["m"]}" xmlns:r="{_REL_NS}"><sheets>{names}</sheets></workbook>')
        rels = "".join(
            f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
            for i in range(1, len(sheets) + 1))
        styles_id = len(sheets) + 1
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   f'{rels}<Relationship Id="rId{styles_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   '</Relationships>')
        z.writestr("xl/styles.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   f'<styleSheet xmlns="{_NS["m"]}">'
                   '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
                   '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE8D7"/><bgColor indexed="64"/></patternFill></fill></fills>'
                   '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
                   '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs>'
                   '</styleSheet>')
        for i, (_name, rows, widths, header_rows, *rest) in enumerate(sheets, start=1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", _sheet_xml(rows, widths, header_rows, rest[0] if rest else None))
    return buf.getvalue()
