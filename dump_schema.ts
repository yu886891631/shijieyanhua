/* eslint-disable */
// @ts-nocheck
import _ from 'lodash';
import fs from 'node:fs';
import path from 'node:path';
import z from 'zod';

async function dumpAll(): Promise<void> {
  const schema_files = fs.globSync('src/**/schema.ts');
  for (const schema_file of schema_files) {
    try {
      globalThis._ = _;
      globalThis.z = z;
      const module = await import(
        (process.platform === 'win32' ? 'file://' : '') + path.resolve(import.meta.dirname, schema_file)
      );
      if (!_.has(module, 'Schema')) {
        continue;
      }
      let schema = _.get(module, 'Schema');
      if (_.isFunction(schema)) {
        schema = schema();
      }
      const out_path = path.join(path.dirname(schema_file), 'schema.json');
      fs.writeFileSync(out_path, JSON.stringify(z.toJSONSchema(schema, { io: 'input', reused: 'ref' }), null, 2) + '\n');
      console.log(`已生成 ${out_path}`);
    } catch (e) {
      console.error(`生成 '${schema_file}' 对应的 schema.json 失败: ${e}`);
      process.exitCode = 1;
    }
  }
}

void dumpAll();
