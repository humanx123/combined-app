import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:3307';
const browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
await fs.mkdir('.qa', {recursive:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for (const width of [320,360,390,640,820,1024,1440]) {
    await page.setViewportSize({width,height:width===1440?1100:844});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('main img').evaluateAll(async images=>{images.forEach(img=>img.loading='eager');await Promise.all(images.map(img=>img.decode()));});
    const layout = await page.evaluate(()=>{
      const root=document.querySelector('.landing');
      const logo=document.querySelector('.lp-wordmark').getBoundingClientRect();
      const cta=document.querySelector('.lp-hero-actions a').getBoundingClientRect();
      return {overflow:root.scrollWidth>root.clientWidth,logo:{left:logo.left,right:logo.right,center:(logo.left+logo.right)/2},buttonCenter:(cta.left+cta.right)/2,headings:[...root.querySelectorAll('h1,h2,h3')].map(el=>getComputedStyle(el).textAlign),frames:[...root.querySelectorAll('.lp-frame')].map(el=>({border:getComputedStyle(el).borderTopWidth,shadow:getComputedStyle(el).boxShadow}))};
    });
    assert(!layout.overflow,`${width}px: page fits`);
    assert(layout.logo.left>=0&&layout.logo.right<=width,`${width}px: full wordmark fits`);
    assert(Math.abs(layout.logo.center-width/2)<2);
    assert(Math.abs(layout.buttonCenter-width/2)<2);
    assert(layout.headings.every(value=>value==='center'));
    assert(layout.frames.every(value=>value.border==='0px'&&value.shadow==='none'));
    assert.equal(await page.locator('.lp-copy p,.lp-facts,.lp-ticker').count(),0);
    if(width===390||width===1440) await page.screenshot({path:`.qa/vibe-centered-hero-${width}.png`});
    const theory=page.locator('.lp-theory');
    await theory.scrollIntoViewIfNeeded();
    const location=await theory.evaluate(el=>{const root=document.querySelector('.landing');return(el.getBoundingClientRect().top+root.scrollTop)/root.scrollHeight;});
    assert(location>.6&&location<.9,`MTW remains lower on page: ${location}`);
    if(width===390||width===1440) {
      const box=await theory.boundingBox();
      if(box.height>844) await page.setViewportSize({width,height:Math.ceil(box.height)+80});
      await theory.scrollIntoViewIfNeeded();
      await theory.screenshot({path:`.qa/vibe-centered-mtw-${width}.png`});
      await page.setViewportSize({width,height:width===1440?1100:844});
    }
    await page.evaluate(()=>{const root=document.querySelector('.landing');root.style.scrollBehavior='auto';root.scrollTo({top:root.scrollHeight,behavior:'instant'});});
    const footer=page.locator('.lp-legal');
    await footer.scrollIntoViewIfNeeded();
    assert.equal(await footer.getByRole('link',{name:'MusicTheory.Work',exact:true}).getAttribute('href'),'https://musictheory.work/');
    assert.equal(await footer.getByRole('link',{name:'Criston Jackson',exact:true}).getAttribute('href'),'https://www.linkedin.com/in/criston-jackson/');
    const footerLinks=await footer.locator('a').evaluateAll(links=>links.map(el=>{const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')??el.textContent,left:r.left,right:r.right,bottom:r.bottom};}));
    assert(footerLinks.every(r=>r.left>=0&&r.right<=width&&r.bottom<=(width===1440?1100:844)+1),`${width}px: all footer links fit: ${JSON.stringify(footerLinks)}`);
    if(width===390||width===1440) await page.screenshot({path:`.qa/vibe-centered-footer-${width}.png`});
    console.log(`${width}px: centered content, logo, plain screenshots, footer links, and MTW placement passed.`);
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.waitForTimeout(2200);
  assert(await page.locator('.lp-wordmark .vibe-letter').evaluateAll(els=>els.some(el=>el.getAnimations().some(animation=>animation.playState==='running'))));
  assert(await page.locator('.lp-wordmark svg animateTransform, .lp-wordmark animateTransform').count()>0);
  await page.screenshot({path:'.qa/vibe-centered-hero-animated.png'});
  await page.locator('.mtw-identity').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('.mtw-identity svg')?.dataset.identityState==='monogram');
  await page.waitForTimeout(1400);
  const mark=await page.locator('.mtw-identity path').first().getAttribute('d');
  await page.waitForFunction(()=>document.querySelector('.mtw-identity svg')?.dataset.identityState==='wordmark');
  await page.waitForTimeout(1600);
  assert.notEqual(await page.locator('.mtw-identity path').first().getAttribute('d'),mark);
  assert.deepEqual(errors,[]);
  console.log('Original Vibe animations, MTW morph, reduced motion, and runtime checks passed.');
} finally {await browser.close();}
