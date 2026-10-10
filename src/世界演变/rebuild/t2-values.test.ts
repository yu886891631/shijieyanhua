import assert from 'node:assert/strict';
import test from 'node:test';
import { type T2Field } from './t2-template';
import {
  compareT2WorldTime,
  decodeT2Cell,
  decodeT2Decimal,
  describeT2FieldControl,
  encodeT2Cell,
  encodeT2Decimal,
  t2CandidateKey,
  validateT2Cell,
} from './t2-values';

function field(type: T2Field['type'], constraints: T2Field['constraints'] = {}): T2Field {
  const controls: Record<T2Field['type'], T2Field['control']> = {
    text: 'single-line',
    integer: 'integer',
    number: 'number',
    decimal: 'decimal',
    boolean: 'toggle',
    enum: 'select',
    'string-list': 'string-list',
    reference: 'reference',
    'reference-list': 'reference-list',
    'world-time': 'world-time',
  };
  return {
    id: 'value',
    sqlName: 'f_value',
    name: '值',
    description: '固定测试字段',
    type,
    required: false,
    nullable: true,
    readonly: false,
    hiddenUi: false,
    permissions: { manualWrite: true, aiWrite: true },
    visibility: { user: true, evolutionAi: true, mainAi: true },
    constraints,
    control: controls[type],
  };
}

const codecCases: { type: T2Field['type']; value: unknown; constraints?: T2Field['constraints'] }[] = [
  { type: 'text', value: '' },
  { type: 'text', value: '<script>不是可执行代码</script>' },
  { type: 'integer', value: 0 },
  { type: 'integer', value: Number.MIN_SAFE_INTEGER },
  { type: 'number', value: 0.1 },
  { type: 'decimal', value: '-12.30', constraints: { precision: 10, scale: 2 } },
  { type: 'boolean', value: false },
  { type: 'enum', value: '在场', constraints: { enumValues: ['在场', '离场'] } },
  { type: 'string-list', value: [] },
  { type: 'string-list', value: ['甲', '乙'] },
  {
    type: 'reference',
    value: { tableId: 'npc', rowId: 'one' },
    constraints: { reference: { tableIds: ['npc'], onDelete: 'restrict' } },
  },
  { type: 'reference-list', value: [], constraints: { reference: { tableIds: ['npc'], onDelete: 'clear' } } },
  {
    type: 'reference-list',
    value: [
      { tableId: 'npc', rowId: 'one' },
      { tableId: 'npc', rowId: 'two' },
    ],
    constraints: { reference: { tableIds: ['npc'], onDelete: 'clear' } },
  },
  {
    type: 'world-time',
    value: { calendarId: 'era', ordinalMinute: -200, display: '纪元之前' },
    constraints: { calendarId: 'era' },
  },
];

for (const sample of codecCases)
  test(`T2 ${sample.type} 的 JSON/物理单元格往返保留原值 ${JSON.stringify(sample.value)}`, () => {
    const definition = field(sample.type, sample.constraints);
    assert.deepEqual(decodeT2Cell(definition, encodeT2Cell(definition, sample.value)), sample.value);
    assert.deepEqual(decodeT2Cell(definition, encodeT2Cell(definition, null)), null);
    assert.equal(decodeT2Cell(definition, encodeT2Cell(definition, undefined)), undefined);
  });

test('缺失、NULL、空串、false、0、空列表具有不同的物理表达', () => {
  assert.deepEqual(encodeT2Cell(field('text'), undefined), { present: false, value: null });
  assert.deepEqual(encodeT2Cell(field('text'), null), { present: true, value: null });
  assert.deepEqual(encodeT2Cell(field('text'), ''), { present: true, value: '' });
  assert.deepEqual(encodeT2Cell(field('boolean'), false), { present: true, value: 0 });
  assert.deepEqual(encodeT2Cell(field('integer'), 0), { present: true, value: 0 });
  assert.deepEqual(encodeT2Cell(field('string-list'), []), { present: true, value: '[]' });
});

test('必填不等于非空字符串；显式NULL遵守独立nullable设置', () => {
  const required = { ...field('text'), required: true, nullable: false };
  assert.throws(() => encodeT2Cell(required, undefined), /必填/);
  assert.throws(() => validateT2Cell(required, null), /NULL/);
  assert.equal(validateT2Cell(required, ''), '');
  assert.throws(() => decodeT2Cell(required, { present: false, value: null }), /缺失/);
});

test('编码不把数字、布尔、枚举错误类型转换成正确类型', () => {
  assert.throws(() => validateT2Cell(field('integer'), '1'), /整数/);
  assert.throws(() => validateT2Cell(field('number'), Infinity));
  assert.throws(() => validateT2Cell(field('number'), -0));
  assert.throws(() => validateT2Cell(field('boolean'), 0), /布尔/);
  assert.throws(() => validateT2Cell(field('enum', { enumValues: ['甲'] }), '乙'), /枚举/);
  assert.throws(() => decodeT2Cell(field('boolean'), { present: true, value: 2 }), /0 或 1/);
  assert.throws(() => decodeT2Cell(field('text'), { present: false, value: '偷偷保留' }), /缺失/);
});

test('整数与数字范围、文本长度及列表数量都硬性校验', () => {
  assert.throws(() => validateT2Cell(field('integer'), Number.MAX_SAFE_INTEGER + 1), /安全整数/);
  assert.throws(() => validateT2Cell(field('number'), Number.MAX_SAFE_INTEGER + 1), /安全范围/);
  assert.throws(() => validateT2Cell(field('integer', { min: 0, max: 4 }), -1), /下限/);
  assert.throws(() => validateT2Cell(field('number', { min: 0, max: 4 }), 4.1), /上限/);
  assert.throws(() => validateT2Cell(field('text', { maxLength: 2 }), '三个字'), /长度/);
  assert.throws(() => validateT2Cell(field('string-list', { maxItems: 1 }), ['甲', '乙']), /数量/);
  assert.throws(() => validateT2Cell(field('string-list'), ['甲', '甲']), /重复/);
});

test('精确小数不舍入，不接受指数/数值/多余精度/负零', () => {
  const definition = field('decimal', { precision: 10, scale: 2 });
  assert.equal(encodeT2Decimal('12.30', definition), 1230);
  assert.equal(decodeT2Decimal(-1, definition), '-0.01');
  for (const value of [12.3, '12.3', '1.230', '01.23', '-0.00', '1e2', '+1.23']) {
    assert.throws(() => encodeT2Decimal(value, definition));
  }
  assert.throws(() => encodeT2Decimal('100000000.00', definition), /精度/);
  assert.throws(() => encodeT2Decimal('900719925474099.20', field('decimal', { precision: 15, scale: 2 })), /精度/);
  assert.throws(() => encodeT2Decimal('1.00', field('decimal', { precision: 30, scale: 2 })));
  assert.equal(decodeT2Decimal(999_999_999_999_999, field('decimal', { precision: 15, scale: 2 })), '9999999999999.99');
});

test('引用携带表与行身份，目标表、额外字段和重复成员均校验', () => {
  const definition = field('reference', { reference: { tableIds: ['npc'], onDelete: 'restrict' } });
  assert.throws(() => validateT2Cell(definition, { tableId: 'organization', rowId: 'one' }), /目标范围/);
  assert.throws(() => validateT2Cell(definition, { tableId: 'npc', rowId: 'one', name: '张三' }), /不支持/);
  const multiple = { ...definition, type: 'reference-list' as const, control: 'reference-list' as const };
  assert.throws(
    () =>
      validateT2Cell(multiple, [
        { tableId: 'npc', rowId: 'one' },
        { tableId: 'npc', rowId: 'one' },
      ]),
    /重复/,
  );
  assert.notEqual(
    t2CandidateKey({ tableId: 'npc', rowId: 'same' }),
    t2CandidateKey({ tableId: 'organization', rowId: 'same' }),
  );
  let calls = 0;
  const evil = Object.defineProperty({ tableId: 'npc', rowId: 'one' }, 'tableId', {
    enumerable: true,
    get() {
      calls += 1;
      return 'npc';
    },
  });
  assert.throws(() => t2CandidateKey(evil));
  assert.equal(calls, 0);
});

test('世界时间仅比较相同纪元序分钟，不借Date猜测未知纪元', () => {
  const one = { calendarId: 'era', ordinalMinute: 7, display: '第三日' };
  const two = { calendarId: 'era', ordinalMinute: 8, display: '第三日下一分钟' };
  assert.equal(compareT2WorldTime(one, two), -1);
  assert.equal(compareT2WorldTime(two, one), 1);
  assert.equal(compareT2WorldTime(one, { ...one, display: '另一个格式' }), 0);
  assert.throws(() => compareT2WorldTime(one, { ...two, calendarId: 'other' }), /跨纪元/);
  assert.throws(
    () => validateT2Cell(field('world-time', { calendarId: 'era' }), { ...one, calendarId: 'other' }),
    /错误的纪元/,
  );
  assert.throws(() => compareT2WorldTime(one, { ...two, ordinalMinute: Number.MAX_SAFE_INTEGER + 1 }), /安全整数/);
});

test('恶意getter/toJSON、非JSON和损坏物理JSON均不会成为合法值', () => {
  let getterCount = 0;
  const evil = Object.defineProperty({}, 'tableId', {
    enumerable: true,
    get() {
      getterCount += 1;
      return 'npc';
    },
  });
  assert.throws(() =>
    validateT2Cell(field('reference', { reference: { tableIds: ['npc'], onDelete: 'restrict' } }), evil),
  );
  assert.equal(getterCount, 0);
  assert.throws(() =>
    validateT2Cell(field('text'), {
      toJSON() {
        throw new Error('执行了');
      },
    }),
  );
  assert.throws(() => decodeT2Cell(field('string-list'), { present: true, value: '[' }));
  assert.throws(() => decodeT2Cell(field('string-list'), { present: true, value: ' '.repeat(256001) }), /超限/);
});

test('控件映射保持字段说明/false默认/精确小数文本和只读含义', () => {
  const definition = { ...field('boolean'), defaultValue: false };
  const description = describeT2FieldControl(definition);
  assert.equal(description.inputType, 'checkbox');
  assert.equal(description.defaultValue, false);
  assert.equal(description.hasDefault, true);
  assert.equal(description.readonly, false);
  assert.equal(describeT2FieldControl(definition, { rowLocked: true }).readonly, true);
  const hidden = { ...definition, hiddenUi: true, permissions: { manualWrite: true, aiWrite: false } };
  assert.equal(describeT2FieldControl(hidden).readonly, false);
  assert.equal(describeT2FieldControl(hidden, { actor: 'ai' }).readonly, true);
  assert.equal(describeT2FieldControl(field('decimal', { precision: 10, scale: 2 })).inputType, 'text');
  assert.match(describeT2FieldControl(field('decimal', { precision: 10, scale: 2 })).constraintText, /安全范围/);
  const copied = describeT2FieldControl(field('enum', { enumValues: ['甲'] }));
  copied.options?.push('乙');
  assert.deepEqual(field('enum', { enumValues: ['甲'] }).constraints.enumValues, ['甲']);
});
