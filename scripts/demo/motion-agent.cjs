#!/usr/bin/env node
// Deterministic provider fixture. Real file writes exercise Lattice's live sync.
const fs = require('node:fs/promises');
const { createInterface } = require('node:readline');
if (process.argv.includes('--version')) { console.log('codex-cli demo-fixture'); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const notify = (method, params) => send({ method, params });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let guided = false;
async function limitedRun() {
  notify('turn/started', { turn: { id: 'demo-turn' } });
  await pause(1900);
  throw Error('Token limit reached. A teammate can continue this task on their own account.');
}
async function polishRun() {
  notify('turn/started', { turn: { id: 'demo-turn' } });
  await say('I’ll make the message fallback clearer and verify the finished changes.');
  const file = 'src/notifications.ts';
  let source = await fs.readFile(file, 'utf8');
  notify('item/started', { item: { type: 'fileChange', changes: [{ path: file }] } });
  await pause(1800);
  source = source.replace('text: `Issue ${event.action}: ${event.title}`', 'text: `GitHub · Issue ${event.action}: ${event.title}`');
  await fs.writeFile(file, source);
  await pause(2300);
  require('node:child_process').execFileSync('npm', ['test']);
  await say('Both changes are verified. Ready for the pull request.', 'done');
  notify('turn/completed', { turn: { id: 'demo-turn', status: 'completed' } });
}
async function githubRun() {
  notify('turn/started', { turn: { id: 'demo-turn' } });
  await say('I’ll add an issue-event guard in src/github.ts, so Slack only receives supported issue actions.');
  await pause(1500);
  notify('item/started', { item: { type: 'fileChange', changes: [{ path: 'src/github.ts' }] } });
  const lines = ['export function isIssueEvent(type: string, action?: string) {', '  const supported = ["opened", "closed", "reopened"];', '  return type === "issues" &&', '    supported.includes(action ?? "opened");', '}'];
  let content = '';
  for (const line of lines) {
    for (let n = 0; n < line.length; n += 4) {
      await fs.writeFile('src/github.ts', content + line.slice(0, n + 4) + '\n');
      await pause(160);
    }
    content += line + '\n'; await pause(350);
  }
  await pause(1300);
  content = content.replace('const supported', 'const supportedActions').replace('supported.includes', 'supportedActions.includes');
  await fs.writeFile('src/github.ts', content);
  await pause(1300);
  await say('The event guard is ready. Opened, closed, and reopened issues now pass; unrelated events are ignored.', 'done');
  notify('turn/completed', { turn: { id: 'demo-turn', status: 'completed' } });
}
async function say(text, id = 'reply') {
  for (const word of text.match(/.{1,14}/g) || []) {
    notify('item/agentMessage/delta', { itemId: id, delta: word });
    await pause(95);
  }
}
async function run() {
  notify('turn/started', { turn: { id: 'demo-turn' } });
  await say('I’ll add rich Slack messages in src/notifications.ts. You can follow and steer the changes as I work.');
  await pause(1500);
  notify('item/started', { item: { type: 'fileChange', changes: [{ path: 'src/notifications.ts' }] } });
  const file = 'src/notifications.ts';
  let source = await fs.readFile(file, 'utf8');
  const lines = [
    '    blocks: [',
    '      {',
    '        type: "section",',
    '        text: {',
    '          type: "mrkdwn",',
    '          text: event.title,',
    '        },',
    '      },',
    '    ],',
  ];
  let inserted = '';
  const original = source;
  for (const line of lines) {
    for (let n = 0; n < line.length; n += 5) {
      source = original.replace('  };', inserted + line.slice(0, n + 5) + '\n  };');
      await fs.writeFile(file, source);
      await pause(240);
    }
    inserted += line + '\n';
    await pause(450);
  }
  // Revisit earlier lines so the remote caret visibly travels in both directions.
  await pause(1400);
  source = source.replace('"opened" | "closed"', '"opened" | "closed" | "reopened"');
  await fs.writeFile(file, source);
  await pause(1600);
  await say('The message block is ready. I’m checking the title and link formatting next.', 'progress');
  for (let i = 0; i < 90 && !guided; i++) await pause(600);
  if (!guided && process.env.LATTICE_FINAL_DEMO) throw Error('Demo must receive real teammate steering before continuing.');
  if (guided) await say('Got it — I’ll make the issue title clickable and include the event action.', 'guidance');
  source = source.replace('text: event.title,', 'text: `<${event.githubUrl}|${event.title}>`,');
  await fs.writeFile(file, source);
  await pause(1600);
  source = source.replace('`GitHub issue: ${event.title}`', '`Issue ${event.action}: ${event.title}`');
  await fs.writeFile(file, source);
  await pause(1600);
  source = source.replace('text: `<${event.githubUrl}|${event.title}>`,', 'text: `*<${event.githubUrl}|${event.title}>*`,');
  await fs.writeFile(file, source);
  await pause(1800);
  notify('item/started', { item: { type: 'commandExecution', command: 'npm test' } });
  const { execFileSync } = require('node:child_process');
  const result = execFileSync('npm', ['test'], { encoding: 'utf8' });
  notify('item/completed', { item: { type: 'commandExecution', aggregatedOutput: result } });
  await say('Done. Slack alerts now show a bold, clickable issue title and the event action. npm test passes. Ready for Maya’s review.', 'done');
  notify('turn/completed', { turn: { id: 'demo-turn', status: 'completed' } });
}
createInterface({ input: process.stdin }).on('line', raw => {
  const message = JSON.parse(raw);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'thread/start' || message.method === 'thread/resume') send({ id: message.id, result: { thread: { id: 'demo-thread' } } });
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'demo-turn' } } });
    const task = (message.params?.input || []).map(i => i.text || '').join('\n');
    const action = task.startsWith('Polish the Slack fallback') ? polishRun
      : task.includes('Add an issue-event guard')
        ? (process.env.LATTICE_FINAL_DEMO && process.env.LATTICE_DEMO_NAME === 'Maya' && !task.includes('Continue this handed-off task') ? limitedRun : githubRun)
        : run;
    action().catch(error => notify('turn/completed', { turn: { id: 'demo-turn', status: 'failed', error: { message: error.message } } }));
  }
  if (message.method === 'turn/steer') { guided = true; send({ id: message.id, result: {} }); }
});
