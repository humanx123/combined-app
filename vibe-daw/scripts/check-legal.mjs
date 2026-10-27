import fs from 'node:fs/promises';
const config = JSON.parse(await fs.readFile('legal/operator.json','utf8').catch(() => { throw new Error('Release requires confirmed operator details in legal/operator.json and generated Terms/Privacy pages.'); }));
if (!config.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email ?? '') || !config.location?.trim()) throw new Error('Legal name, working contact email, and state/country are required.');
const site=JSON.parse(await fs.readFile('legal/site.json','utf8'));
const agreement=await fs.readFile(site.vibe ? 'src/legal/acceptance.ts' : 'src/lib/legal.ts','utf8');
const version=agreement.match(/LEGAL_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for (const slug of ['terms','privacy']) {
  const html=await fs.readFile(`public/${slug}/index.html`,'utf8');
  if (!version || !html.includes(`Version ${version}`) || !html.includes(esc(config.name)) || !html.includes(`mailto:${esc(config.email)}`) || !html.includes(esc(config.location)) || /pending|unpublished draft/i.test(html)) throw new Error(`${slug} must be generated with the confirmed operator and current agreement version.`);
}
console.log('Published legal pages match the confirmed operator and signup policy version.');
