import { chromium } from 'playwright-core';
import { mkdir, writeFile, copyFile, chmod, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { RecordlyCapture } from './recordly-capture.mjs';
import { makeFixture, launch, workbench, frameWith, frameWithButton, until, evaluate, freePort, scratch, browsers, children } from './native-record.mjs';
const exec = promisify(execFile);
const useRecordly = !!process.env.LATTICE_RECORDLY;
const out = resolve(process.env.RECORDLY_OUTPUT_DIR || (process.env.LATTICE_FINAL_DEMO ? 'artifacts/demo-final' : useRecordly ? 'artifacts/demo-recordly' : 'artifacts/demo-motion'));
const destination = resolve(process.env.LATTICE_FINAL_DEMO ? 'artifacts/lattice-final-demo.mp4' : useRecordly ? 'artifacts/lattice-recordly-demo.mp4' : 'artifacts/lattice-two-laptops-demo.mp4');
const nativeCapture = useRecordly ? new RecordlyCapture(out) : null;
const WIDTH = 1264;
process.env.LATTICE_CAPTURE_WIDTH = String(WIDTH);
await mkdir(out, { recursive: true });
let stageBrowser, context, stage, video, recording = false, loop, relayPid, start;
const pages = [];
const chapters = [];
const typingEvents = [];
let capturedPairs = 0;
const nativePositions = new Set();
const livePositions = new Set();
const side = page => pages.indexOf(page);
const button = (frame, name) => frame.getByRole('button', { name, exact: true });
const pointerPositions = new Map();
async function glide(page, x, y) {
  await page.bringToFront();
  const from = pointerPositions.get(page) || {x: 500, y: 360};
  for (let i = 1; i <= 22; i++) {
    const t = i / 22, ease = t * t * (3 - 2 * t);
    await point(page, from.x + (x - from.x) * ease, from.y + (y - from.y) * ease);
    await delay(20);
  }
}

async function mark(name) {
  const time = (Date.now() - start) / 1000;
  chapters.push({ name, time });
  console.log(`${time.toFixed(1)}s ${name}`);
  if (!useRecordly) await stage.screenshot({ path: join(out, `${String(chapters.length).padStart(2, '0')}-${name}.png`) });
}
async function point(page, x, y, down = false) {
  pointerPositions.set(page, {x,y});
  nativeCapture?.point(side(page), x, y, down);
  await stage.evaluate(({ x, y, down }) => window.pointer(x, y, down), { x: x + (side(page) ? 1288 : 8), y: y + 160, down });
  await page.mouse.move(x, y);
}
async function click(page, locator, { positioned = false } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw Error('Invisible click target');
  if (!positioned) {
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await delay(650);
  }
  await point(page, box.x + box.width / 2, box.y + box.height / 2, true);
  await locator.click();
  await delay(500);
}
async function type(page, locator, value, speed = 38) {
  await click(page, locator);
  await locator.fill('');
  for (const character of value) {
    typingEvents.push({timeMs:Date.now()-start,side:side(page),kind:character===' '?'space':'key'});
    await locator.pressSequentially(character, {delay:speed});
  }
  await delay(700);
}
async function openFile(instance, page, name) {
  await instance.command('workbench.action.quickOpen');
  const input = page.locator('.quick-input-widget input').last();
  await input.fill(name);
  await delay(350);
  await page.keyboard.press('Enter');
  await delay(700);
  // A newly teleported workspace may not have populated Quick Open's index yet.
  // Open the actual document explicitly and pin it so later view changes retain it.
  const api = `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(instance.extensionPath, 'driver.cjs'))})('vscode')`;
  await evaluate(await instance.debugPort(), `(async()=>{const v=${api};const uri=v.Uri.joinPath(v.workspace.workspaceFolders[0].uri,'src',${JSON.stringify(name)});const doc=await v.workspace.openTextDocument(uri);await v.window.showTextDocument(doc,{preview:false});return true})()`);
  await page.locator('.monaco-editor .view-lines').filter({ hasText: name === 'github.ts' ? 'isIssueEvent' : 'slackMessage' }).first().waitFor({ timeout: 15000 });
}
async function dashboard(page) {
  await click(page, page.locator('[aria-label^="Lattice Sessions"]').first());
  return frameWith(page, 'Your sessions');
}
async function beginCapture() {
  stageBrowser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  context = await stageBrowser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, ...(useRecordly ? {} : {recordVideo: { dir: out, size: { width: 2560, height: 1440 } }}) });
  stage = await context.newPage(); video = stage.video();
  await stage.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;background:#000;overflow:hidden}
    .screen{position:absolute;top:160px;width:1264px;height:1120px;object-fit:fill}#left{left:8px}#right{left:1288px}
    #pointer{position:absolute;left:0;top:0;width:23px;height:31px;z-index:5;pointer-events:none;transform:translate(480px,400px);filter:drop-shadow(0 2px 2px #000);transition:transform .55s cubic-bezier(.2,.7,.25,1)}
    .ring{position:absolute;width:42px;height:42px;border:2px solid #b9d7ff;border-radius:50%;animation:ripple .6s ease-out forwards;z-index:4}
    @keyframes ripple{from{transform:translate(-50%,-50%) scale(.3);opacity:1}to{transform:translate(-50%,-50%) scale(1.3);opacity:0}}
    </style><img class="screen" id="left"><img class="screen" id="right">
    <svg id="pointer" viewBox="0 0 23 31"><path d="M2 1v24l6-7 6 12 4-2-6-11h9Z" fill="white" stroke="#172033" stroke-width="1.6"/></svg>
    <script>window.pointer=(x,y,down)=>{document.querySelector('#pointer').style.transform='translate('+x+'px,'+y+'px)';if(down){let r=document.createElement('div');r.className='ring';r.style.left=x+'px';r.style.top=y+'px';document.body.append(r);setTimeout(()=>r.remove(),650)}};window.framesIn=async(frames)=>{await Promise.all(frames.map(async(src,i)=>{if(src) {const im=document.querySelector(i?'#right':'#left');im.src='data:image/jpeg;base64,'+src;await im.decode().catch(()=>{})}}))}</script>`);
  recording = true;
  loop = (async () => {
    while (recording) {
      const t = Date.now();
      // ScreenCaptureKit records the application continuously at 60fps. The
      // screenshot stage is only used by the legacy recorder, never as footage.
      if (!useRecordly) {
      const images = await Promise.all(pages.map(async p => {
        try { return (await p.screenshot({ type: 'jpeg', quality: 88, timeout: 2500 })).toString('base64'); } catch { return null; }
      }));
      await stage.evaluate(frames => window.framesIn(frames), images);
      }
      capturedPairs++;
      if (nativeCapture?.startTime) {
        for (const [index,p] of pages.entries()) for (const f of p.frames()) {
          if (!f.url().startsWith('vscode-webview://')) continue;
          const cursor = f.locator('.live-agent-cursor.is-typing .live-caret').first();
          // Webviews are disposed while returning from a session to the dashboard.
          // A telemetry sample must not terminate the native recording on navigation.
          const b = await cursor.count().catch(() => 0) ? await cursor.boundingBox({timeout:100}).catch(() => null) : null;
          if (b && b.y > 0) nativeCapture.agentPoint(index, b.x, b.y + b.height / 2);
        }
      }
      if (capturedPairs % 4 === 0) {
        const positions = await pages[0].evaluate(() => [...document.querySelectorAll('.monaco-editor .view-lines span')].flatMap(el => {
          if (!getComputedStyle(el, '::after').content.includes('avatars')) return [];
          const r = el.getBoundingClientRect(); return [`${Math.round(r.x)}:${Math.round(r.y)}`];
        })).catch(() => []);
        positions.forEach(p => nativePositions.add(p));
        for (const f of pages[0].frames()) if (f.url().startsWith('vscode-webview://')) {
          const poses = await f.locator('.live-agent-cursor').evaluateAll(elements => elements.map(el => el.getAttribute('style'))).catch(() => []);
          poses.forEach(p => livePositions.add(p));
        }
      }
      await delay(Math.max(1, (useRecordly ? 600 : 65) - (Date.now() - t)));
    }
  })();
  await delay(1000); start = nativeCapture ? await nativeCapture.start(pages) : Date.now();
}

try {
  const fixture = await makeFixture();
  const codex = join(fixture.bin, 'demo-codex');
  await copyFile(resolve('scripts/demo/motion-agent.cjs'), codex); await chmod(codex, 0o755);
  process.env.LATTICE_DEMO_CODEX = codex;
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.${fixture.origin}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = fixture.remote;
  const relayPort = await freePort();
  const host = await launch('host', fixture.project, fixture.extension, 'Maya', relayPort, fixture.bin);
  const guest = await launch('guest', fixture.downloads, undefined, 'Noah', relayPort, fixture.bin);
  const hp = await workbench(host), gp = await workbench(guest);
  pages.push(hp, gp);
  await gp.getByText(basename(fixture.vsix), { exact: true }).waitFor({ timeout: 30000 });
  await until(async () => (await host.command('lattice.demo.state'))?.ready, 'Host ready');
  await openFile(host, hp, 'notifications.ts');
  await host.command('workbench.action.closePanel');
  await beginCapture();
  await mark('two-vscode-windows');
  await delay(3000);
  await host.command('lattice.open');
  await host.command('workbench.action.closePanel');
  await delay(2400); await mark('extension-and-accounts');
  let hf = await dashboard(hp);
  await host.command('workbench.action.closePanel');
  await hp.locator('.part.panel').waitFor({state:'hidden',timeout:10000});
  await mark('dashboard-panel-closed');
  await click(hp, button(hf, 'New session'));
  await type(hp, hf.getByRole('textbox', { name: 'What are you building?' }), 'GitHub issue alerts');
  const slider = hf.getByRole('slider', { name: 'Agent coordination strictness' });
  const box = await slider.boundingBox();
  const startX = box.x + 8 + (box.width - 16) * 5 / 9;
  await point(hp, startX, box.y + box.height / 2); await delay(650);
  await point(hp, startX, box.y + box.height / 2, true); await hp.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const x = startX + (box.width - 16) * 2 / 9 * i / 24;
    await point(hp, x, box.y + box.height / 2); await delay(35);
  }
  await hp.mouse.up(); await delay(1500); await mark('strictness-slider');
  await hp.locator('.part.panel').waitFor({state:'hidden',timeout:10000});
  await click(hp, button(hf, 'Start session'));
  const hosted = await until(async () => {
    const s = await host.command('lattice.demo.state'); return s?.ready && s.proof && s.root !== fixture.project && s;
  }, 'Host session', 90000);
  relayPid = Number((await exec('lsof', ['-ti', `TCP:${relayPort}`, '-sTCP:LISTEN'])).stdout.trim().split('\n')[0]);
  await host.command('lattice.open');
  hf = await frameWithButton(hp, 'Invite');
  await openFile(host, hp, 'notifications.ts');
  await host.command('workbench.action.closePanel');
  await click(hp, button(hf, 'Invite'));
  await click(hp, button(hf, 'Copy invitation'));
  const invite = await host.command('lattice.demo.clipboard');
  await click(hp, hf.getByRole('button', { name: 'Close dialog', exact: true }));
  await mark('invite-teammate');

  // The real Explorer context menu installs the downloaded VSIX directly.
  const download = gp.getByText(basename(fixture.vsix), { exact: true });
  const downloadBox = await download.boundingBox();
  await glide(gp, downloadBox.x + 90, downloadBox.y + downloadBox.height / 2);
  await delay(700);
  await point(gp, downloadBox.x + 90, downloadBox.y + downloadBox.height / 2, true);
  await download.click({ button: 'right' });
  await delay(900);
  await click(gp, gp.getByRole('menuitem', { name: /Install Extension/ }));
  const installed = await until(async () => (await readdir(guest.extensions)).find(n => n.startsWith('harshaldhaduk.lattice-sync-')), 'Guest install');
  guest.extensionPath = join(guest.extensions, installed);
  await guest.command('workbench.extensions.search', '@installed lattice');
  await delay(1600);
  await click(gp, gp.getByText('Lattice Sync', { exact: true }).first());
  await delay(1800); await mark('extension-installed');
  await guest.command('workbench.action.reloadWindow').catch(() => {}); await delay(2200);
  await workbench(guest);
  let gf = await dashboard(gp);
  await guest.command('workbench.action.closePanel');
  await click(gp, button(gf, 'Join session'));
  await click(gp, gf.getByRole('textbox', { name: 'Invitation link' }));
  await gf.getByRole('textbox', { name: 'Invitation link' }).fill(invite);
  await delay(1100);
  await click(gp, button(gf, 'Join live work'));
  const joined = await until(async () => {
    const s = await guest.command('lattice.demo.state'); return s?.ready && s.proof && s.root !== fixture.downloads && s;
  }, 'Guest teleport', 90000);
  await guest.command('lattice.open');
  await openFile(guest, gp, 'notifications.ts');
  await guest.command('workbench.action.closePanel');
  await delay(2000); await mark('teleported-codebase');
  for (const instance of [host, guest]) await instance.command('workbench.action.toggleSidebarVisibility');
  await host.command('lattice.composer.focus');
  let hc = await frameWithButton(hp, 'Send prompt');
  await mark('existing-provider-accounts');
  await delay(2500);
  await type(hp, hc.getByRole('textbox', { name: 'Prompt your agent' }), 'Add rich Slack alerts in src/notifications.ts. Include the issue title and GitHub link.', 24);
  await click(hp, button(hc, 'Send prompt'));
  await frameWithButton(hp, 'Pause following');
  await mark('maya-auto-follows-own-agent');
  await host.command('workbench.action.closePanel');
  await mark('agent-starts-editing');
  await delay(2500);
  await mark('native-live-cursor');
  gf = await frameWithButton(gp, 'Follow live edits');
  await click(gp, button(gf, 'Follow live edits').first());
  await delay(2500); await mark('follow-live-edits');
  await mark('cursor-tracking-start');
  const trackingFrame = await frameWith(hp, 'Maya’s agent');
  let tracking = true;
  const tracker = (async () => {
    while(tracking) {
      const caret = trackingFrame.locator('.live-agent-cursor .live-caret').first();
      const b = await caret.boundingBox({timeout:100}).catch(()=>null);
      if(b) nativeCapture?.agentPoint(0,b.x,b.y+b.height/2);
      await delay(100);
    }
  })();
  await glide(hp, 1000, 690);
  await delay(7000); tracking=false; await tracker; await mark('cursor-tracking-end');
  await guest.command('lattice.composer.focus');
  const gc = await frameWithButton(gp, 'Send prompt');
  const lanes = gc.getByRole('combobox', { name: 'Agent conversation' });
  const options = await lanes.locator('option').evaluateAll(opts => opts.map(o => ({ value: o.value, text: o.textContent })));
  const maya = options.find(o => o.text.includes('Maya'));
  if (!maya) throw Error('Maya conversation missing');
  await click(gp, lanes); await lanes.selectOption(maya.value); await gp.keyboard.press('Escape');
  await type(gp, gc.getByRole('textbox', { name: 'Prompt your agent' }), 'Make the title clickable and include the event action.', 28);
  await click(gp, button(gc, 'Send guidance'));
  await mark('teammate-guidance');
  hf = await frameWithButton(hp, 'Allow guidance');
  await delay(1000); await click(hp, button(hf, 'Allow guidance'));
  await mark('guidance-approved');
  await guest.command('workbench.action.closePanel');
  await delay(10000); await mark('finished-live-change');
  await until(async () => {
    const content = await readFile(join(hosted.root, 'src/notifications.ts'), 'utf8');
    return content.includes('Issue ${event.action}') && content.includes('*<${event.githubUrl}');
  }, 'Synced final source');
  await exec('npm', ['test'], { cwd: hosted.root });
  // Maya's next real provider request receives a controlled quota failure.
  await host.command('lattice.composer.focus');
  const secondComposer = await frameWithButton(hp, 'Send prompt');
  const secondLanes = secondComposer.getByRole('combobox', { name: 'Agent conversation' });
  const ownOptions = await secondLanes.locator('option').evaluateAll(opts => opts.map(o => ({ value: o.value, text: o.textContent })));
  const own = ownOptions.find(o => /My agent/.test(o.text));
  if (!own) throw Error('Own agent conversation missing');
  await click(hp, secondLanes); await secondLanes.selectOption(own.value); await hp.keyboard.press('Escape');
  await type(hp, secondComposer.getByRole('textbox', { name: 'Prompt your agent' }), 'Add an issue-event guard in src/github.ts for opened, closed, and reopened actions.', 25);
  await click(hp, button(secondComposer, 'Send prompt'));
  await frameWith(hp, 'Usage limit reached');
  await host.command('workbench.action.closePanel');
  await mark('maya-token-limit');
  await delay(2000); await mark('maya-limit-read-complete');
  gf = await frameWithButton(gp, 'Continue this task · your account');
  const takeover = button(gf, 'Continue this task · your account');
  const takeoverBox = await takeover.boundingBox();
  await glide(gp, takeoverBox.x + takeoverBox.width / 2, takeoverBox.y + takeoverBox.height / 2);
  await mark('noah-handoff-notice');
  await delay(2000); await mark('noah-handoff-read-complete');
  await click(gp, takeover, { positioned: true });
  await frameWith(gp, 'Noah’s agent');
  await mark('noah-accepts-handoff');
  await guest.command('workbench.action.closePanel');
  hf = await frameWithButton(hp, 'Follow live edits');
  await click(hp, button(hf, 'Follow live edits').last());
  await delay(1500); await mark('maya-follows-noah');
  await until(async () => (await readFile(join(hosted.root, 'src/github.ts'), 'utf8')).includes('supportedActions.includes'), 'Second agent changes');
  await delay(4500);
  await guest.command('lattice.composer.focus');
  gf = await frameWithButton(gp, 'Send prompt');
  const noahLanes = gf.getByRole('combobox', { name: 'Agent conversation' });
  const noahOptions = await noahLanes.locator('option').evaluateAll(opts => opts.map(o => ({value:o.value,text:o.textContent})));
  await click(gp, noahLanes); await noahLanes.selectOption(noahOptions.find(o => /My agent/.test(o.text)).value); await gp.keyboard.press('Escape');
  await type(gp, gf.getByRole('textbox', { name: 'Prompt your agent' }), 'Polish the Slack fallback text and run the tests.', 27);
  await click(gp, button(gf, 'Send prompt'));
  await mark('noah-own-prompt');
  await guest.command('workbench.action.closePanel');
  await delay(9500); await mark('both-people-contributed');
  hf = await frameWithButton(hp, 'Return to project');
  await click(hp, button(hf, 'Return to project'));
  await click(hp, hp.getByText('Create a pull request', { exact: true }));
  const title = hp.locator('.quick-input-widget').filter({ hasText: 'Pull request title' }).locator('input');
  await title.waitFor({ state: 'visible', timeout: 90000 });
  await type(hp, title, 'Send GitHub issue alerts to Slack', 35);
  await hp.keyboard.press('Enter');
  await hp.getByRole('button', { name: 'Publish PR', exact: true }).waitFor({ timeout: 90000 });
  await delay(3000); await mark('review-pull-request');
  await click(hp, button(hp, 'Publish PR'));
  await until(async () => (await host.command('lattice.demo.state'))?.root !== hosted.root, 'Host returns');
  await host.command('lattice.dashboard'); await delay(2000);
  hf = await frameWith(hp, 'Your sessions');
  await mark('returned-to-dashboard');
  await delay(1500); await click(hp, button(hf, 'Completed'));
  await mark('completed-branch-and-pr');
  await guest.command('lattice.dashboard'); await delay(1500);
  gf = await frameWith(gp, 'Your sessions');
  await click(gp, button(gf, 'Completed'));
  hf = await frameWith(hp, 'PR #184');
  const sessionTile = hf.locator('.session-tile').first();
  const tileBox = await sessionTile.boundingBox();
  await mark('session-hover-start');
  await glide(hp, tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2);
  await delay(1000);
  await glide(hp, tileBox.x + tileBox.width + 36, tileBox.y + tileBox.height / 2);
  await delay(400);
  await mark('session-hover-end');
  await glide(hp, 530, 650); await delay(3000); await mark('pr-ready-for-review');
  await delay(6000); await mark('fade-to-black');
  recording = false; await loop;
  const duration = (Date.now() - start) / 1000;
  await context.close();
  if (nativeCapture) await nativeCapture.stop(chapters,typingEvents);
  else {
    await video.saveAs(join(out, 'continuous-source.webm'));
    await exec('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-i', join(out, 'continuous-source.webm'), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', destination], { timeout: 300000 });
  }
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ destination, width: 2560, height: 1440, audio: false, duration, capturedPairs, nativeCursorPositions: nativePositions.size, liveCursorPositions: livePositions.size, chapters, real: ['two native VS Code windows', 'installed VSIX', 'session relay', 'workspace teleport', 'provider adapter', 'live filesystem changes', 'remote agent cursors', 'guidance', 'tests'], scripted: ['agent inference fixture', 'GitHub PR service fixture'], scratch }, null, 2));
  console.log(JSON.stringify({ destination, duration, capturedPairs, nativePositions: nativePositions.size, livePositions: livePositions.size }));
} catch (error) {
  nativeCapture?.abort();
  recording = false; await loop?.catch(() => {});
  console.error(error);
  for (const [i, p] of pages.entries()) {
    await p.screenshot({ path: join(out, `error-${i}.png`) }).catch(() => {});
    for (const f of p.frames()) console.error((await f.locator('body').innerText().catch(() => '')).slice(-4000));
  }
  if (context) { await context.close().catch(() => {}); await video?.saveAs(join(out, 'incomplete-source.webm')).catch(() => {}); }
  throw error;
} finally {
  await stageBrowser?.close();
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of children) child.kill();
  if (relayPid) try { process.kill(relayPid, 'SIGTERM'); } catch {}
}
