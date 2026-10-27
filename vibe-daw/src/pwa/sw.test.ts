import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

it('keeps legal pages and the landing page separate from the offline studio shell', async () => {
  const records = new Map<string, Response>([['/index.html',new Response('landing')],['/app.html',new Response('studio')]]);
  const cache = { put:async (key:string,response:Response) => { records.set(key,response); }, match:async (key:string) => records.get(key)?.clone() };
  let offline = false;
  const context = vm.createContext({ URL,Response, self:{ addEventListener:() => {} }, caches:{ open:async () => cache, match:cache.match }, fetch:async () => { if(offline) throw new Error('offline'); return new Response('terms'); } });
  const code = readFileSync('src/pwa/sw.js','utf8').replace('__PRECACHE__','[]');
  vm.runInContext(code,context);
  await context.page({url:'https://vibedaw.org/terms/'});
  expect(await records.get('/index.html')?.clone().text()).toBe('landing');
  expect(await records.get('/app.html')?.clone().text()).toBe('studio');
  offline = true;
  expect(await (await context.page({url:'https://vibedaw.org/terms/'})).text()).toBe('terms');
  expect(await (await context.page({url:'https://vibedaw.org/studio'})).text()).toBe('studio');
  expect(await (await context.page({url:'https://vibedaw.org/'})).text()).toBe('landing');
  expect((await context.page({url:'https://vibedaw.org/privacy/'})).type).toBe('error');
});
