/* eslint-disable import-x/no-nodejs-modules -- Explicit loopback-only fake-host acceptance server, never in an import bundle. */
/** Displays the actual built H4 entry against fake JSONL/local APIs. No real Tavern or paid API. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { wiringFixture } from './t15-wiring-test-fixtures';
import { T15_DAILY_VERSION, T15_DAILY_SCRIPT_ID } from './t15-daily-runtime';
const fixture = await wiringFixture();
const saved = await (await fixture.port.fetchImpl('http://127.0.0.1:8000/api/chats/get', {})).json();
const empty = [
  { chat_metadata: { variables: {} } },
  { name: '测试卡', is_user: false, mes: '仅用于本地验收的剧情', extra: {} },
];
fixture.close();
const bundle = () => readFile(`dist/世界演变候选版/${T15_DAILY_VERSION}/index.js`);
const stats = { chatReads: 0, chatWrites: 0, bookWrites: 0, modelRequests: 0 };
const html = (
  doc: typeof saved,
) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>H4 本地模拟验收（非酒馆）</title><style>body{font:16px system-ui;background:#edf4e9;color:#294333}#extensionsMenu{padding:20px}#extensionsMenu>div{cursor:pointer;padding:15px;border:1px solid #789a78}</style><p>独立本地模拟宿主；不是你的酒馆聊天。此服务器不实现聊天保存、模型请求、世界书写入。</p><div id="extensionsMenu"></div><script>
const doc=${JSON.stringify(doc).replaceAll('<', '\\u003c')};
const listeners=new Map();
const names=['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_SWIPE_DELETED','MESSAGE_SENT','MESSAGE_RECEIVED','GENERATION_STARTED','GENERATION_STOPPED','CHARACTER_EDITED','CHARACTER_DELETED','WORLDINFO_UPDATED','WORLDINFO_SETTINGS_UPDATED','GENERATION_ENDED'];
window.tavern_events=Object.fromEntries(names.map(n=>[n,n]));
window.SillyTavern={characterId:0,characters:[{name:'本地模拟测试卡',avatar:'fixture.png',chat:'fixture'}],chat:doc.slice(1),chatMetadata:doc[0].chat_metadata,getCurrentChatId:()=> 'fixture',getRequestHeaders:()=>({'X-CSRF-TOKEN':'local-fake'}),getWorldInfoNames:()=>['主书']};
window.$=fn=>fn();window.eventOn=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);return{stop:()=>listeners.get(name).delete(fn)}};
window.getButtonEvent=name=>name;window.getScriptId=()=>${JSON.stringify(T15_DAILY_SCRIPT_ID)};window.getScriptTrees=()=>[];window.getVariables=()=>({});window.insertOrAssignVariables=()=>{throw new Error('模拟页面禁止保存配置')};window.getCharWorldbookNames=()=>({primary:'主书',additional:[]});window.getWorldbook=async()=>[];
</script><script src="/entry.js"></script></html>`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self' about:; worker-src blob:; base-uri 'none'",
  );
  if (req.method === 'POST' && path === '/api/chats/get') {
    stats.chatReads++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.headers.referer?.includes('/empty') ? empty : saved));
  } else if (req.method === 'POST' && path === '/api/characters/chats') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([{ file_name: 'fixture.jsonl' }]));
  } else if (req.method === 'GET' && path === '/stats') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(stats));
  } else if (req.method === 'GET' && path === '/entry.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(await bundle());
  } else if (req.method === 'GET' && (path === '/' || path === '/empty')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html(path === '/empty' ? empty : saved));
  } else {
    res.writeHead(403);
    res.end('No model/chat-write/worldbook-write endpoint in fake host');
  }
});
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (addr && typeof addr !== 'string')
    console.log(
      `H4 fake-host visual server http://127.0.0.1:${addr.port}/ (saved) and /empty (empty), no real chat/model/book writes`,
    );
});
