import { crc32 } from 'node:zlib';

// Aide de test : fabrique un petit .xlsx à la main (zip sans compression), sans dépendance de plus.
// Une cellule texte devient une chaîne en ligne ; un nombre, un nombre ; « 2026-11-01 » (ISO), une date.

type FeuilleTest = { nom: string; lignes: (string | number)[][] };

const colonne = (i: number) => String.fromCharCode(65 + i);
const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const serie = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569;

function feuilleXml(lignes: (string | number)[][]) {
  const rangs = lignes.map((l, r) => `<row r="${r + 1}">` + l.map((c, i) => {
    const ref = colonne(i) + (r + 1);
    if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return `<c r="${ref}" s="1"><v>${serie(c)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`;
  }).join('') + '</row>').join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rangs}</sheetData></worksheet>`;
}

function zip(fichiers: Record<string, string>): Uint8Array {
  const morceaux: Buffer[] = [], centrale: Buffer[] = [];
  let decalage = 0;
  for (const [nom, texte] of Object.entries(fichiers)) {
    const n = Buffer.from(nom), d = Buffer.from(texte), c = crc32(d);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(c, 14);
    local.writeUInt32LE(d.length, 18); local.writeUInt32LE(d.length, 22); local.writeUInt16LE(n.length, 26);
    const entree = Buffer.alloc(46);
    entree.writeUInt32LE(0x02014b50, 0); entree.writeUInt16LE(20, 4); entree.writeUInt16LE(20, 6); entree.writeUInt32LE(c, 16);
    entree.writeUInt32LE(d.length, 20); entree.writeUInt32LE(d.length, 24); entree.writeUInt16LE(n.length, 28);
    entree.writeUInt32LE(decalage, 42);
    morceaux.push(local, n, d); centrale.push(entree, n);
    decalage += 30 + n.length + d.length;
  }
  const dir = Buffer.concat(centrale), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(centrale.length / 2, 8); fin.writeUInt16LE(centrale.length / 2, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(decalage, 16);
  return new Uint8Array(Buffer.concat([...morceaux, dir, fin]));
}

export function xlsxDeTest(feuilles: FeuilleTest[]): Uint8Array {
  const ns = 'http://schemas.openxmlformats.org/';
  const fichiers: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${feuilles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>${feuilles.map((f, i) => `<sheet name="${echapper(f.nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}package/2006/relationships">${feuilles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${feuilles.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  feuilles.forEach((f, i) => { fichiers[`xl/worksheets/sheet${i + 1}.xml`] = feuilleXml(f.lignes); });
  return zip(fichiers);
}
