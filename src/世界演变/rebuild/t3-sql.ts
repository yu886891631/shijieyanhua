/** The supported SQL grammar is intentionally smaller than SQLite's grammar. */
export type T3Scalar = null | boolean | number | string;

export type T3Value = { kind: 'literal'; value: T3Scalar } | { kind: 'parameter'; index: number };

export type T3SelectStatement = {
  kind: 'select';
  table: string;
  columns: string[];
  targets?: T3Value[];
  orderBy?: '__we_row_id-asc';
  limit?: number;
};

export type T3InsertStatement = { kind: 'insert'; table: string; columns: string[]; values: T3Value[] };

export type T3UpdateStatement = {
  kind: 'update';
  table: string;
  assignments: { column: string; value: T3Value }[];
  targets: T3Value[];
};

export type T3DeleteStatement = { kind: 'delete'; table: string; targets: T3Value[] };

export type T3Statement = T3SelectStatement | T3InsertStatement | T3UpdateStatement | T3DeleteStatement;

export const T3_SQL_LIMITS = Object.freeze({
  maxChars: 20_000,
  maxStatements: 32,
  maxTokens: 4_000,
  maxTargets: 100,
  maxColumns: 256,
  maxNumberChars: 128,
});

export class T3SqlError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`SQL 第 ${position + 1} 个字符：${message}`);
    this.name = 'T3SqlError';
    this.position = position;
  }
}

type Token =
  | { kind: 'word' | 'identifier'; text: string; position: number }
  | { kind: 'literal'; value: number | string; integer?: boolean; position: number }
  | { kind: 'punctuation'; text: '(' | ')' | ',' | ';' | '=' | '?'; position: number };

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,63}$/;
const RESERVED_IDENTIFIERS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'from',
  'where',
  'into',
  'values',
  'set',
  'in',
  'order',
  'by',
  'asc',
  'desc',
  'limit',
  'offset',
  'null',
  'true',
  'false',
  'current_date',
  'current_time',
  'current_timestamp',
  'distinct',
  'all',
  'as',
  'join',
  'on',
  'union',
  'with',
  'case',
  'when',
  'then',
  'else',
  'end',
  'default',
]);

function normalizedDecimal(text: string): string {
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fractional = ''] = unsigned.split('.');
  const fraction = fractional.replace(/0+$/, '');
  const integer = whole.replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function expandedNumber(number: number): string {
  const text = String(number);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fractional = '', exponent] = match;
  const digits = whole + fractional;
  const decimalPosition = whole.length + Number(exponent);
  if (decimalPosition <= 0) return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function parseNumber(text: string, position: number): number {
  if (text.length > T3_SQL_LIMITS.maxNumberChars) throw new T3SqlError('数值字面量过长。', position);
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || Object.is(value, -0)) {
    throw new T3SqlError('数值须在无损支持范围内；不接受负零或无限值。', position);
  }
  if (normalizedDecimal(text) !== normalizedDecimal(expandedNumber(value))) {
    throw new T3SqlError('数值字面量会被舍入，必须改用精确文本或受支持的数字。', position);
  }
  return value;
}

/** Comments are tokenized only outside strings/quoted identifiers, never by SQL splitting regex. */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  function append(token: Token): void {
    if (tokens.length >= T3_SQL_LIMITS.maxTokens) throw new T3SqlError('SQL token 数量超限。', token.position);
    tokens.push(token);
  }
  while (cursor < sql.length) {
    const position = cursor;
    const character = sql[cursor];
    if (/\s/u.test(character)) {
      cursor += 1;
      continue;
    }
    if (sql.startsWith('--', cursor)) {
      cursor += 2;
      while (cursor < sql.length && sql[cursor] !== '\n' && sql[cursor] !== '\r') cursor += 1;
      continue;
    }
    if (sql.startsWith('/*', cursor)) {
      const end = sql.indexOf('*/', cursor + 2);
      if (end < 0) throw new T3SqlError('块注释没有闭合。', position);
      cursor = end + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      let value = '';
      let closed = false;
      cursor += 1;
      while (cursor < sql.length) {
        const current = sql[cursor];
        cursor += 1;
        if (current !== quote) {
          value += current;
        } else if (sql[cursor] === quote) {
          value += quote;
          cursor += 1;
        } else {
          closed = true;
          break;
        }
      }
      if (!closed) throw new T3SqlError('字符串或标识符没有闭合。', position);
      if (quote === "'") {
        append({ kind: 'literal', value, position });
      } else {
        if (!IDENTIFIER.test(value)) throw new T3SqlError('引号标识符必须是规范小写 ASCII 标识符。', position);
        append({ kind: 'identifier', text: value, position });
      }
      continue;
    }
    if (/[a-z_]/i.test(character)) {
      cursor += 1;
      while (cursor < sql.length && /[a-z0-9_]/i.test(sql[cursor])) cursor += 1;
      const text = sql.slice(position, cursor).toLowerCase();
      if (!IDENTIFIER.test(text)) throw new T3SqlError('标识符超出支持范围。', position);
      append({ kind: 'word', text, position });
      continue;
    }
    if (/\d/.test(character) || character === '-') {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?/.exec(sql.slice(cursor));
      if (!match) throw new T3SqlError('不支持该数值或表达式。', position);
      cursor += match[0].length;
      append({ kind: 'literal', value: parseNumber(match[0], position), integer: !match[0].includes('.'), position });
      continue;
    }
    if (
      character === '(' ||
      character === ')' ||
      character === ',' ||
      character === ';' ||
      character === '=' ||
      character === '?'
    ) {
      append({ kind: 'punctuation', text: character, position });
      cursor += 1;
      continue;
    }
    throw new T3SqlError(`不支持字符 ${JSON.stringify(character)} 或对应的 SQL 语法。`, position);
  }
  return tokens;
}

class Parser {
  private cursor = 0;
  private parameterIndex = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly endPosition: number,
  ) {}

  private fail(message: string): never {
    throw new T3SqlError(message, this.tokens[this.cursor]?.position ?? this.endPosition);
  }

  private peekWord(text: string): boolean {
    const token = this.tokens[this.cursor];
    return token?.kind === 'word' && token.text === text;
  }

  private acceptWord(text: string): boolean {
    if (!this.peekWord(text)) return false;
    this.cursor += 1;
    return true;
  }

  private word(text: string): void {
    if (!this.acceptWord(text)) this.fail(`此处必须是 ${text.toUpperCase()}。`);
  }

  private acceptPunctuation(text: string): boolean {
    const token = this.tokens[this.cursor];
    if (token?.kind !== 'punctuation' || token.text !== text) return false;
    this.cursor += 1;
    return true;
  }

  private punctuation(text: string): void {
    if (!this.acceptPunctuation(text)) this.fail(`此处必须是 ${text}。`);
  }

  private identifier(): string {
    const token = this.tokens[this.cursor];
    if (token?.kind !== 'word' && token?.kind !== 'identifier') this.fail('此处必须是规范标识符。');
    if (RESERVED_IDENTIFIERS.has(token.text)) this.fail('标识符不能是 SQL 关键字或内置常量。');
    this.cursor += 1;
    return token.text;
  }

  private businessIdentifier(): string {
    const value = this.identifier();
    if (value.startsWith('__we_')) this.fail('普通 SQL 不得写入系统元数据列。');
    return value;
  }

  private value(): T3Value {
    const token = this.tokens[this.cursor];
    if (token?.kind === 'literal') {
      this.cursor += 1;
      return { kind: 'literal', value: token.value };
    }
    if (this.acceptPunctuation('?')) return { kind: 'parameter', index: this.parameterIndex++ };
    if (this.acceptWord('null')) return { kind: 'literal', value: null };
    if (this.acceptWord('true')) return { kind: 'literal', value: true };
    if (this.acceptWord('false')) return { kind: 'literal', value: false };
    return this.fail('仅接受标量字面量或位置参数 ?，不支持表达式、函数或子查询。');
  }

  private columns(businessOnly: boolean): string[] {
    const columns: string[] = [];
    do {
      if (columns.length >= T3_SQL_LIMITS.maxColumns) this.fail('列数量超限。');
      const column = businessOnly ? this.businessIdentifier() : this.identifier();
      if (columns.includes(column)) this.fail(`列 ${column} 重复。`);
      columns.push(column);
    } while (this.acceptPunctuation(','));
    return columns;
  }

  private targets(): T3Value[] {
    this.word('where');
    if (this.identifier() !== '__we_row_id') this.fail('WHERE 只能按 __we_row_id 明确选择记录。');
    if (this.acceptPunctuation('=')) return [this.value()];
    this.word('in');
    this.punctuation('(');
    const targets: T3Value[] = [];
    do {
      if (targets.length >= T3_SQL_LIMITS.maxTargets) this.fail('目标记录数量超限。');
      targets.push(this.value());
    } while (this.acceptPunctuation(','));
    this.punctuation(')');
    return targets;
  }

  private select(): T3SelectStatement {
    const columns = this.columns(false);
    this.word('from');
    const statement: T3SelectStatement = { kind: 'select', table: this.identifier(), columns };
    if (this.peekWord('where')) statement.targets = this.targets();
    if (this.acceptWord('order')) {
      this.word('by');
      if (this.identifier() !== '__we_row_id') this.fail('仅支持按 __we_row_id 升序排序。');
      this.acceptWord('asc');
      statement.orderBy = '__we_row_id-asc';
    }
    if (this.acceptWord('limit')) {
      const token = this.tokens[this.cursor];
      if (
        token?.kind !== 'literal' ||
        typeof token.value !== 'number' ||
        token.integer !== true ||
        !Number.isSafeInteger(token.value) ||
        token.value < 0
      ) {
        this.fail('LIMIT 必须是非负安全整数常量，不接受参数。');
      }
      this.cursor += 1;
      statement.limit = token.value;
    }
    return statement;
  }

  private insert(): T3InsertStatement {
    this.word('into');
    const table = this.identifier();
    this.punctuation('(');
    const columns = this.columns(true);
    this.punctuation(')');
    this.word('values');
    this.punctuation('(');
    const values: T3Value[] = [];
    do {
      if (values.length >= T3_SQL_LIMITS.maxColumns) this.fail('值数量超限。');
      values.push(this.value());
    } while (this.acceptPunctuation(','));
    this.punctuation(')');
    if (columns.length !== values.length) this.fail('INSERT 列数与值数量必须相同。');
    return { kind: 'insert', table, columns, values };
  }

  private update(): T3UpdateStatement {
    const table = this.identifier();
    this.word('set');
    const assignments: T3UpdateStatement['assignments'] = [];
    do {
      if (assignments.length >= T3_SQL_LIMITS.maxColumns) this.fail('更新列数量超限。');
      const column = this.businessIdentifier();
      if (assignments.some(assignment => assignment.column === column)) this.fail(`更新列 ${column} 重复。`);
      this.punctuation('=');
      assignments.push({ column, value: this.value() });
    } while (this.acceptPunctuation(','));
    return { kind: 'update', table, assignments, targets: this.targets() };
  }

  private delete(): T3DeleteStatement {
    this.word('from');
    const table = this.identifier();
    return { kind: 'delete', table, targets: this.targets() };
  }

  parse(): T3Statement[] {
    const statements: T3Statement[] = [];
    while (this.cursor < this.tokens.length) {
      if (this.acceptPunctuation(';')) continue;
      if (statements.length >= T3_SQL_LIMITS.maxStatements) this.fail('SQL 语句数量超限。');
      let statement: T3Statement;
      if (this.acceptWord('select')) statement = this.select();
      else if (this.acceptWord('insert')) statement = this.insert();
      else if (this.acceptWord('update')) statement = this.update();
      else if (this.acceptWord('delete')) statement = this.delete();
      else this.fail('仅支持受限 SELECT、INSERT、UPDATE、DELETE。');
      statements.push(statement);
      if (this.cursor < this.tokens.length && !this.acceptPunctuation(';')) {
        this.fail('语句包含不支持的语法，或缺少语句间的分号。');
      }
    }
    if (statements.length === 0) this.fail('没有可执行的受限 SQL 语句。');
    return statements;
  }
}

/** Parse data only: this function never executes SQL or accesses a host/database. */
export function parseT3Sql(sql: string): T3Statement[] {
  if (typeof sql !== 'string') throw new T3SqlError('SQL 必须是字符串。', 0);
  if (sql.length > T3_SQL_LIMITS.maxChars) throw new T3SqlError('SQL 文本长度超限。', 0);
  if (sql.includes('\0')) throw new T3SqlError('SQL 不接受 NUL 字符。', sql.indexOf('\0'));
  return new Parser(tokenize(sql), sql.length).parse();
}

/** The count describes parser-generated ASTs; user-supplied ASTs are not an execution API. */
export function countT3Parameters(statements: T3Statement[]): number {
  let maximum = -1;
  function visit(value: T3Value): void {
    if (value.kind === 'parameter') maximum = Math.max(maximum, value.index);
  }
  for (const statement of statements) {
    if (statement.kind === 'insert') statement.values.forEach(visit);
    if (statement.kind === 'update') statement.assignments.forEach(assignment => visit(assignment.value));
    if (statement.kind !== 'insert') statement.targets?.forEach(visit);
  }
  return maximum + 1;
}
