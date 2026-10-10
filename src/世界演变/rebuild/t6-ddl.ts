/** Advanced DDL is an import notation for T2, never an executable SQLite script. */
import { normalizeT2Template, type T2Cell, type T2Field, type T2Template } from './t2-template';
import { describeT3SchemaDdl } from './t3-schema';
import { parseT3Sql } from './t3-sql';
import { canonicalT4Json } from './t4-protocol';
import { copyT6, dropT6Field, newT6Field, newT6Table } from './t6-editor';

const HEADER = '-- WE-T6-TEMPLATE ';
export function exportT6Ddl(input: T2Template): string {
  const template = normalizeT2Template(input);
  return `${HEADER}${canonicalT4Json(template)}\n${describeT3SchemaDdl(template)}`;
}
type Token = { kind: 'word' | 'identifier' | 'value' | 'punct'; text: string; value?: T2Cell };
function tokens(text: string): Token[] {
  const result: Token[] = [];
  let p = 0;
  while (p < text.length) {
    if (/\s/u.test(text[p])) {
      p++;
      continue;
    }
    if (result.length >= 4000) throw new Error('DDL token 超限');
    const start = p,
      c = text[p++];
    if ('(),;'.includes(c)) {
      result.push({ kind: 'punct', text: c });
      continue;
    }
    if (c === "'" || c === '"') {
      let value = '',
        closed = false;
      while (p < text.length) {
        const v = text[p++];
        if (v !== c) value += v;
        else if (text[p] === c) {
          value += c;
          p++;
        } else {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('DDL 引号未闭合');
      result.push(c === "'" ? { kind: 'value', text: '', value } : { kind: 'identifier', text: value });
      continue;
    }
    const word = /^[a-z_][a-z0-9_]*/i.exec(text.slice(start));
    if (word) {
      p = start + word[0].length;
      result.push({ kind: 'word', text: word[0] });
      continue;
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(text.slice(start));
    if (number) {
      p = start + number[0].length;
      const statement = parseT3Sql(`INSERT INTO we_probe (f_probe) VALUES (${number[0]});`)[0];
      if (statement.kind !== 'insert' || statement.values[0].kind !== 'literal') throw new Error('DDL 数值无效');
      result.push({ kind: 'value', text: '', value: statement.values[0].value });
      continue;
    }
    throw new Error('DDL 包含不支持的表达式、注释或符号');
  }
  return result;
}

/** Full annotated exchange preserves all metadata; plain DDL supports only explicit simple declarations. */
export function importT6Ddl(baseInput: T2Template, text: string, group: 'macro' | 'micro' = 'micro'): T2Template {
  const base = normalizeT2Template(baseInput);
  if (typeof text !== 'string' || !text.trim() || text.length > 1_000_000) throw new Error('DDL 为空或超限');
  if (text.startsWith(HEADER)) {
    const end = text.indexOf('\n');
    if (end < 0) throw new Error('完整 DDL 缺少规范模板头');
    const json = text.slice(HEADER.length, end),
      template = normalizeT2Template(JSON.parse(json));
    if (
      template.id !== base.id ||
      json !== canonicalT4Json(template) ||
      text.slice(end + 1) !== describeT3SchemaDdl(template)
    )
      throw new Error('模板身份、规范头或派生 DDL 不一致；不接受附加 SQL');
    return template;
  }
  if (text.length > 20_000) throw new Error('普通 DDL 超过 20000 字符');
  const list = tokens(text),
    template = copyT6(base);
  let p = 0,
    statements = 0;
  const accept = (s: string) => list[p]?.kind !== 'value' && list[p]?.text.toUpperCase() === s && (++p, true);
  const expect = (s: string) => {
    if (!accept(s)) throw new Error(`DDL 需要 ${s}，未知语法不丢弃`);
  };
  const identifier = (pattern: RegExp) => {
    const token = list[p++];
    if (!token || !['word', 'identifier'].includes(token.kind) || !pattern.test(token.text))
      throw new Error('只支持 we_ 表名和 f_ 业务列；系统列不可编辑');
    return token.text;
  };
  const field = (): T2Field => {
    const sqlName = identifier(/^f_[a-z][a-z0-9_]{0,61}$/),
      id = sqlName.slice(2);
    const token = list[p++];
    if (!token || token.kind !== 'word' || !['TEXT', 'INTEGER', 'REAL'].includes(token.text.toUpperCase()))
      throw new Error('普通 DDL 类型仅支持 TEXT / INTEGER / REAL');
    const type = token.text.toUpperCase(),
      item = newT6Field(id, id, type === 'TEXT' ? 'text' : type === 'INTEGER' ? 'integer' : 'number', template);
    if (accept('NOT')) {
      expect('NULL');
      item.nullable = false;
      item.required = true;
    } else accept('NULL');
    if (accept('DEFAULT')) {
      if (accept('NULL')) item.defaultValue = null;
      else {
        const v = list[p++];
        if (v?.kind !== 'value') throw new Error('DEFAULT 只允许静态字面量');
        item.defaultValue = v.value!;
      }
    }
    return item;
  };
  while (p < list.length) {
    if (++statements > 32) throw new Error('DDL 最多 32 条');
    if (accept('CREATE')) {
      expect('TABLE');
      const sqlName = identifier(/^we_[a-z][a-z0-9_]{0,60}$/);
      if (template.tables.some(t => t.sqlName === sqlName)) throw new Error('表已存在');
      const table = newT6Table(sqlName.slice(3), sqlName.slice(3), group);
      expect('(');
      table.fields = [field()];
      while (accept(',')) table.fields.push(field());
      expect(')');
      expect('STRICT');
      expect(';');
      table.context.fieldIds = table.fields.map(f => f.id);
      table.export.fieldIds = table.fields.map(f => f.id);
      table.export.titleFieldId = table.fields[0].id;
      template.tables.push(table);
    } else if (accept('ALTER')) {
      expect('TABLE');
      const sqlName = identifier(/^we_[a-z][a-z0-9_]{0,60}$/),
        index = template.tables.findIndex(t => t.sqlName === sqlName);
      if (index < 0) throw new Error('表不存在');
      if (accept('ADD')) {
        expect('COLUMN');
        template.tables[index].fields.push(field());
      } else if (accept('DROP')) {
        expect('COLUMN');
        const name = identifier(/^f_[a-z][a-z0-9_]{0,61}$/),
          f = template.tables[index].fields.find(f => f.sqlName === name);
        if (!f) throw new Error('字段不存在');
        template.tables[index] = dropT6Field(template.tables[index], f.id);
      } else throw new Error('ALTER 只支持 ADD COLUMN / DROP COLUMN；不允许更换稳定身份');
      expect(';');
    } else if (accept('DROP')) {
      expect('TABLE');
      const sqlName = identifier(/^we_[a-z][a-z0-9_]{0,60}$/);
      if (!template.tables.some(t => t.sqlName === sqlName)) throw new Error('表不存在');
      template.tables = template.tables.filter(t => t.sqlName !== sqlName);
      expect(';');
    } else throw new Error('只支持 CREATE TABLE、ALTER TABLE、DROP TABLE；触发器/索引/视图/表达式被拒绝');
  }
  return normalizeT2Template(template);
}
