import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexRunner } from "../src/providers/codex";
import type { AgentHooks } from "../src/providers/types";
test("Codex adapter streams, routes approval decisions, and reports usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lattice-codex-"));
  const file = join(dir, "fake-codex");
  await writeFile(
    file,
    `#!/usr/bin/env node
const readline=require('node:readline');const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread'}}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn'}}});send({method:'turn/started',params:{turn:{id:'turn'}}});send({method:'item/agentMessage/delta',params:{itemId:'a',delta:'Hello '}});send({id:91,method:'item/commandExecution/requestApproval',params:{command:'echo test'}});}if(m.id===91&&m.result){send({method:'item/agentMessage/delta',params:{itemId:'a',delta:m.result.decision}});send({method:'thread/tokenUsage/updated',params:{tokenUsage:{last:{inputTokens:10,outputTokens:3}}}});send({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});}});
`,
  );
  await chmod(file, 0o755);
  const runner = new CodexRunner(file);
  const chunks: string[] = [];
  const usage: number[] = [];
  let approval = "";
  const hooks: AgentHooks = {
    text: (t) => chunks.push(t),
    tool: () => {},
    status: () => {},
    usage: (i, o) => usage.push(i, o),
    approve: async (title) => {
      approval = title;
      return false;
    },
    ask: async () => ({}),
  };
  try {
    assert.equal(
      await runner.run({ cwd: dir, prompt: "test", mode: "ask", hooks }),
      "thread",
    );
    assert.deepEqual(chunks, ["Hello ", "decline"]);
    assert.deepEqual(usage, [10, 3]);
    assert.equal(approval, "Run command");
  } finally {
    runner.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
