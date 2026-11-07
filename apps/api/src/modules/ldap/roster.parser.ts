import { loginUsernameSchema, ROSTER_COLUMNS, ROSTER_LIMITS } from '@plataforma/contracts';

/**
 * Leitura da lista de lotação. O arquivo é só lido como texto: nenhum SQL é executado.
 * Aceita:
 * - INSERTs (MySQL/MariaDB/PostgreSQL): `INSERT INTO t (col, …) VALUES (…), (…);`
 * - COPY do pg_dump: `COPY t (col, …) FROM stdin;` + linhas separadas por tabulação
 * - CSV com cabeçalho (separado por vírgula, ponto e vírgula ou tabulação)
 * Das colunas, só login, nome, secretaria, setor e código do setor são usadas; o resto
 * (senhas, fotos, datas…) é descartado aqui mesmo.
 */

export interface RosterRow {
  /** Linha (CSV) ou registro (SQL), contando de 1, para as mensagens. */
  line: number;
  username: string;
  displayName: string | null;
  secretaria: string | null;
  setor: string | null;
  setorId: string | null;
}

export interface ParsedRoster {
  format: 'sql' | 'csv';
  rows: RosterRow[];
  problems: string[];
}

type Field = keyof typeof ROSTER_COLUMNS;
type Cell = string | null;

export class RosterParseError extends Error {}

export function parseRoster(content: string): ParsedRoster {
  const text = content.replace(/^\uFEFF/, '');
  const isSql = /\bINSERT\s+(?:IGNORE\s+)?INTO\b/i.test(text) || /^\s*COPY\s+\S+/im.test(text);
  const tables = isSql ? parseSql(text) : [parseCsv(text)];
  const problems: string[] = [];
  const rows: RosterRow[] = [];
  let usable = 0;
  let record = 0;

  for (const t of tables) {
    const idx = columnIndexes(t.columns);
    if (idx.username === undefined || (idx.setor === undefined && idx.setorId === undefined)) {
      if (tables.length === 1) {
        throw new RosterParseError(
          `Não encontrei as colunas de login e setor. Colunas do arquivo: ${t.columns.join(', ') || '(nenhuma)'}. ` +
            'Use, por exemplo: username, nome, unidade (secretaria), setor, setor_id.',
        );
      }
      problems.push(`Tabela ${t.name || '(sem nome)'} ignorada: não tem colunas de login e setor.`);
      continue;
    }
    usable++;
    for (const values of t.rows) {
      record++;
      if (rows.length >= ROSTER_LIMITS.maxRows) {
        throw new RosterParseError(`O arquivo passa de ${ROSTER_LIMITS.maxRows} linhas.`);
      }
      const get = (f: Field): string | null => {
        const i = idx[f];
        const v = i === undefined ? null : (values[i] ?? null);
        const s = v?.trim();
        return s ? s : null;
      };
      const line = t.firstLine ? t.firstLine + record - 1 : record;
      const rawLogin = get('username');
      const login = loginUsernameSchema.safeParse(rawLogin ?? '');
      if (!login.success) {
        problems.push(
          rawLogin
            ? `Linha ${line}: login "${rawLogin.slice(0, 40)}" inválido; ignorada.`
            : `Linha ${line}: sem login; ignorada.`,
        );
        continue;
      }
      rows.push({
        line,
        username: login.data,
        displayName: get('displayName')?.slice(0, 160) ?? null,
        secretaria: get('secretaria')?.slice(0, 200) ?? null,
        setor: get('setor')?.slice(0, 160) ?? null,
        setorId: get('setorId')?.slice(0, 64) ?? null,
      });
    }
  }
  if (!usable)
    throw new RosterParseError('Nenhuma tabela do arquivo tem colunas de login e setor.');
  return { format: isSql ? 'sql' : 'csv', rows, problems };
}

/** "Nome_Completo", "`setor_id`" → "nome_completo", "setor_id". */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .replace(/^[`"'[]|[`"'\]]$/g, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function columnIndexes(columns: string[]): Partial<Record<Field, number>> {
  const norm = columns.map(normalizeHeader);
  const out: Partial<Record<Field, number>> = {};
  for (const [field, names] of Object.entries(ROSTER_COLUMNS) as [Field, readonly string[]][]) {
    const i = norm.findIndex((c) => names.includes(c));
    if (i >= 0) out[field] = i;
  }
  return out;
}

interface Table {
  name: string;
  columns: string[];
  rows: Cell[][];
  firstLine?: number;
}

/* ----------------------------------- SQL ---------------------------------- */

function parseSql(src: string): Table[] {
  const tables = new Map<string, Table>();
  const table = (name: string, columns: string[]) => {
    const key = `${name}|${columns.join(',')}`;
    let t = tables.get(key);
    if (!t) tables.set(key, (t = { name, columns, rows: [] }));
    return t;
  };
  const header =
    /\bINSERT\s+(?:IGNORE\s+)?INTO\s+([^\s(]+)\s*\(([^)]*)\)\s*VALUES\s*|^\s*COPY\s+([^\s(]+)\s*\(([^)]*)\)\s+FROM\s+stdin;?[ \t]*\r?\n/gim;
  let m: RegExpExecArray | null;
  while ((m = header.exec(src))) {
    if (m[1] !== undefined) {
      const t = table(m[1], splitColumns(m[2]!));
      header.lastIndex = readValues(src, header.lastIndex, t.rows);
    } else {
      const t = table(m[3]!, splitColumns(m[4]!));
      header.lastIndex = readCopy(src, header.lastIndex, t.rows);
    }
  }
  if (!tables.size) {
    const sawInsertWithoutColumns = /\bINSERT\s+INTO\s+\S+\s+VALUES/i.test(src);
    throw new RosterParseError(
      sawInsertWithoutColumns
        ? 'Os INSERTs do arquivo não dizem os nomes das colunas. Exporte com os nomes das colunas (ex.: "INSERT INTO usuarios (username, setor, …) VALUES …").'
        : 'Não encontrei INSERTs nem COPY no arquivo.',
    );
  }
  return [...tables.values()];
}

function splitColumns(list: string): string[] {
  return list.split(',').map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ''));
}

/** Lê "(…), (…), …" a partir de `i`; devolve a posição depois do último registro. */
function readValues(src: string, start: number, out: Cell[][]): number {
  let i = start;
  const n = src.length;
  const ws = () => {
    while (i < n && /\s/.test(src[i]!)) i++;
  };
  for (;;) {
    ws();
    if (src[i] !== '(') return i;
    i++;
    const row: Cell[] = [];
    for (;;) {
      ws();
      const c = src[i];
      if (c === "'" || c === '"') {
        const [value, next] = readQuoted(src, i, c);
        row.push(value);
        i = next;
      } else {
        let j = i;
        while (j < n && src[j] !== ',' && src[j] !== ')') j++;
        const token = src.slice(i, j).trim();
        row.push(/^null$/i.test(token) ? null : token);
        i = j;
      }
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ')') {
        i++;
        break;
      }
      throw new RosterParseError(`Não consegui ler o arquivo perto de: "${src.slice(i, i + 40)}"`);
    }
    out.push(row);
    ws();
    if (src[i] === ',') {
      i++;
      continue;
    }
    return i;
  }
}

/** Texto entre aspas no SQL: '' (padrão) e \' (MySQL) são aspas dentro do texto. */
function readQuoted(src: string, start: number, quote: string): [string, number] {
  let i = start + 1;
  let out = '';
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '\\' && i + 1 < n) {
      const e = src[i + 1]!;
      out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === '0' ? '' : e;
      i += 2;
      continue;
    }
    if (c === quote) {
      if (src[i + 1] === quote) {
        out += quote;
        i += 2;
        continue;
      }
      return [out, i + 1];
    }
    out += c;
    i++;
  }
  throw new RosterParseError('O arquivo termina no meio de um texto entre aspas.');
}

/** Bloco do COPY: linhas com tabulação até "\." ; "\N" é vazio. */
function readCopy(src: string, start: number, out: Cell[][]): number {
  let i = start;
  for (;;) {
    let end = src.indexOf('\n', i);
    if (end < 0) end = src.length;
    const line = src.slice(i, end).replace(/\r$/, '');
    i = end + 1;
    if (line === '\\.' || i > src.length) return Math.min(i, src.length);
    if (!line) continue;
    out.push(
      line
        .split('\t')
        .map((v) =>
          v === '\\N'
            ? null
            : v.replace(/\\(.)/g, (_, e: string) => (e === 't' ? '\t' : e === 'n' ? '\n' : e)),
        ),
    );
  }
}

/* ----------------------------------- CSV ---------------------------------- */

function parseCsv(src: string): Table {
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0]![0];
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      rec.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      rec.push(field);
      field = '';
      if (rec.some((v) => v !== '')) records.push(rec);
      rec = [];
    } else field += c;
  }
  rec.push(field);
  if (rec.some((v) => v !== '')) records.push(rec);
  const [head, ...rows] = records;
  if (!head) throw new RosterParseError('O arquivo está vazio.');
  return { name: '', columns: head, rows, firstLine: 2 };
}
