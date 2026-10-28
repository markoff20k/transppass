"""Lê um .xlsx sem dependências: imprime cada aba como linhas separadas por tab.
Quebras de linha dentro de uma célula viram espaço, para a linha não se partir."""
import sys, zipfile, re
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
WS = re.compile('[\r\n\t]+')

def col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1

def read_sheets(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid_to_target = {r.get('Id'): r.get('Target') for r in rels}
    sheets = {}
    for sheet in wb.find('m:sheets', NS):
        name = sheet.get('name')
        rid = sheet.get('{%s}id' % NS['r'])
        target = rid_to_target[rid]
        target = target if target.startswith('xl/') else 'xl/' + target.lstrip('/')
        root = ET.fromstring(z.read(target))
        rows = []
        for row in root.iter('{%s}row' % NS['m']):
            cells = {}
            for c in row.findall('m:c', NS):
                v = c.find('m:v', NS)
                t = c.get('t')
                val = ''
                if v is not None:
                    val = shared[int(v.text)] if t == 's' else v.text
                elif t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                cells[col_index(c.get('r'))] = WS.sub(' ', val or '')
            width = max(cells) + 1 if cells else 0
            rows.append([cells.get(i, '') for i in range(width)])
        sheets[name] = rows
    return sheets

def dump(path, limit):
    for name, rows in read_sheets(path).items():
        print(f'=== aba "{name}" · {len(rows)} linhas')
        for r in rows[:limit]:
            print('\t'.join(r))
        if len(rows) > limit:
            print(f'... (+{len(rows) - limit} linhas)')

if __name__ == '__main__':
    dump(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 60)
