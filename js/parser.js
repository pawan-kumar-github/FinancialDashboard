// ═══════════════════════════════════════════════════════════════
//  PDF.js worker
// ═══════════════════════════════════════════════════════════════

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ═══════════════════════════════════════════════════════════════
//  DATE & AMOUNT PARSING
// ═══════════════════════════════════════════════════════════════

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function parseDate(s) {
  if (!s) return null;
  s = s.trim().replace(/\s+/g, ' ');

  // MM/DD/YYYY or MM-DD-YYYY or DD/MM/YY etc.
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (a > 12) return new Date(yr, b-1, a); // DD/MM
    return new Date(yr, a-1, b);             // MM/DD
  }

  // YYYY-MM-DD
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);

  // DD MMM YYYY or DD-MMM-YYYY or DD MMM YY
  m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[\s\-](\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo === undefined) return null;
    const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(yr, mo, +m[1]);
  }

  // MMM DD, YYYY or MMM DD YYYY
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return new Date(+m[3], mo, +m[2]);
  }

  // MM/DD (no year)
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return new Date(new Date().getFullYear(), +m[1]-1, +m[2]);

  return null;
}

function parseAmt(s) {
  if (!s) return null;
  let c = s.replace(/,/g, '').replace(/[₹$£€¥\s]/g, '');
  c = c.replace(/^\((.+)\)$/, '-$1'); // (123.45) → -123.45
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

function detectCurrency(lines) {
  const blob = lines.join(' ');
  if (/₹|INR|Rupee/i.test(blob)) return '₹';
  if (/£|GBP|Sterling/i.test(blob)) return '£';
  if (/€|EUR|Euro/i.test(blob)) return '€';
  return '$';
}

// ═══════════════════════════════════════════════════════════════
//  TRANSACTION PATTERNS
// ═══════════════════════════════════════════════════════════════

const AMT_RE   = '(-?[\\d,]+\\.\\d{2})';
const DATE_RE  = '(\\d{1,2}[\\/ -]\\d{1,2}(?:[\\/ -]\\d{2,4})?|\\d{1,2}[\\-\\s][A-Za-z]{3}[\\-\\s]\\d{2,4}|[A-Za-z]{3}\\s+\\d{1,2},?\\s+\\d{4})';
const OPT_AMT  = '((?:-?[\\d,]+\\.\\d{2})|-|0\\.00)';
const DESC_MIN = 3;

const PATTERNS = [
  // Indian/tabular: Date  Description  Debit  Credit  Balance
  {
    re: new RegExp(`^${DATE_RE}\\s+(.{${DESC_MIN},80}?)\\s+${OPT_AMT}\\s+${OPT_AMT}\\s+[\\d,]+\\.\\d{2}\\s*$`),
    fn(m) {
      const dr = (m[3] === '-' || m[3] === '0.00') ? 0 : parseAmt(m[3]);
      const cr = (m[4] === '-' || m[4] === '0.00') ? 0 : parseAmt(m[4]);
      if (dr === 0 && cr === 0) return { ds: m[1], desc: m[2].trim(), amt: null };
      return { ds: m[1], desc: m[2].trim(), amt: cr > 0 ? cr : -dr };
    }
  },
  // Standard: Date  Description  Amount  [Balance]
  {
    re: new RegExp(`^${DATE_RE}\\s+(.{${DESC_MIN},80}?)\\s{2,}${AMT_RE}(?:\\s+${AMT_RE})?\\s*$`),
    fn(m) { return { ds: m[1], desc: m[2].trim(), amt: parseAmt(m[3]) }; }
  },
  // With currency symbol: Date  Description  ₹Amount
  {
    re: new RegExp(`^${DATE_RE}\\s+(.{${DESC_MIN},80}?)\\s+[₹$£€]\\s*${AMT_RE}\\s*$`),
    fn(m) { return { ds: m[1], desc: m[2].trim(), amt: parseAmt(m[3]) }; }
  },
  // Flexible fallback
  {
    re: new RegExp(`^${DATE_RE}\\s+(.{${DESC_MIN},100}?)\\s+[₹$£€]?\\s*${AMT_RE}\\s*$`),
    fn(m) { return { ds: m[1], desc: m[2].trim(), amt: parseAmt(m[3]) }; }
  },
];

// ═══════════════════════════════════════════════════════════════
//  PDF PARSING  — extracts text lines grouped by Y coordinate
// ═══════════════════════════════════════════════════════════════

async function parsePDF(file) {
  setLoading('Reading PDF…');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    setLoading(`Parsing page ${p} of ${pdf.numPages}…`);
    const page = await pdf.getPage(p);
    const tc   = await page.getTextContent();

    const lineMap = new Map();
    for (const item of tc.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5] * 2) / 2; // 0.5px grid
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y).push({ txt: item.str, x: item.transform[4] });
    }

    const sorted = [...lineMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => {
        items.sort((a, b) => a.x - b.x);
        return items.map(i => i.txt).join(' ');
      });

    allLines.push(...sorted);
  }

  return allLines;
}

// ═══════════════════════════════════════════════════════════════
//  TRANSACTION EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractTx(lines) {
  const seen = new Set();
  const txs  = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 10 || line.length > 350) continue;

    for (const { re, fn } of PATTERNS) {
      const m = line.match(re);
      if (!m) continue;

      const { ds, desc, amt } = fn(m);
      if (!desc || desc.length < DESC_MIN) break;
      if (amt === null || isNaN(amt) || Math.abs(amt) < 0.01) break;

      const date = parseDate(ds);
      if (!date || isNaN(date.getTime())) break;
      if (date.getFullYear() < 1990 || date.getFullYear() > 2100) break;

      const key = `${date.toDateString()}|${desc}|${amt}`;
      if (seen.has(key)) break;
      seen.add(key);

      txs.push({
        id:          txs.length,
        date,
        description: desc,
        amount:      amt,
        category:    categorize(desc),
      });
      break;
    }
  }

  txs.sort((a, b) => a.date - b.date);
  return txs;
}
