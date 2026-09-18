import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRunner } from "../src/providers/claude";
import type { AgentHooks } from "../src/providers/types";
test("Claude adapter forwards permissions, streamed text, and cached token usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lattice-claude-"));
  const file = join(dir, "fake-sdk.mjs");
  await writeFile(
    file,
    `export function query({prompt,options}) {if(!prompt[Symbol.asyncIterator]||options.permissionMode!=='default')throw Error('Incorrect options');return {close(){},async *[Symbol.asyncIterator](){const first=await prompt[Symbol.asyncIterator]().next();if(first.value.message.content!=='test')throw Error('Incorrect prompt');const decision=await options.canUseTool('Write',{file_path:'a.ts'},{signal:new AbortController().signal});if(decision.behavior!=='deny')throw Error('Expected denial');yield {type:'stream_event',session_id:'session',event:{type:'message_start',message:{id:'m'}}};yield {type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Hello'}}};yield {type:'assistant',message:{id:'m',content:[{type:'text',text:'Hello world'}]}};yield {type:'result',is_error:false,session_id:'session',usage:{input_tokens:10,cache_read_input_tokens:5,cache_creation_input_tokens:2,output_tokens:3},total_cost_usd:.005};}};}`,
  );
  const runner = new ClaudeRunner("unused", file);
  const text: string[] = [];
  let usage: number[] = [];
  let approval = "";
  const hooks: AgentHooks = {
    text: (t) => text.push(t),
    tool: () => {},
    status: () => {},
    approve: async (t) => {
      approval = t;
      return false;
    },
    ask: async () => ({}),
    usage: (i, o, c) => {
      usage = [i, o, c!];
    },
  };
  try {
    assert.equal(
      await runner.run({ cwd: dir, prompt: "test", mode: "ask", hooks }),
      "session",
    );
    assert.equal(approval, "Write");
    assert.deepEqual(text, ["Hello", "Hello world"]);
    assert.deepEqual(usage, [17, 3, 0.005]);
  } finally {
    runner.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude live guidance enters the same query before the original turn finishes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lattice-steering-"));
  const file = join(dir, "fake-sdk.mjs");
  await writeFile(
    file,
    `export function query({prompt}) { return {close(){}, async *[Symbol.asyncIterator](){ const input=prompt[Symbol.asyncIterator](); const first=await input.next(); if(first.value.message.content!=='initial')throw Error('Wrong initial prompt'); yield {type:'assistant',message:{id:'first',content:[{type:'text',text:'working'}]}}; const second=await input.next(); if(second.value.message.content!=='guidance')throw Error('Missing live guidance'); yield {type:'result',is_error:false,usage:{input_tokens:1,output_tokens:1},total_cost_usd:0}; yield {type:'assistant',message:{id:'second',content:[{type:'text',text:'followed guidance'}]}}; yield {type:'result',is_error:false,usage:{input_tokens:2,output_tokens:2},total_cost_usd:0}; }};}`,
  );
  const runner = new ClaudeRunner("unused", file);
  const messages: string[] = [];
  try {
    await runner.run({
      cwd: dir,
      prompt: "initial",
      mode: "ask",
      hooks: {
        text: (t) => {
          messages.push(t);
          if (t === "working") void runner.steer("guidance");
        },
        tool: () => {},
        status: () => {},
        usage: () => {},
        approve: async () => false,
        ask: async () => ({}),
      },
    });
    assert.deepEqual(messages, ["working", "followed guidance"]);
    await assert.rejects(runner.steer("too late"), /finished/);
  } finally {
    runner.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
