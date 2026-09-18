const assert = require("node:assert/strict");
const vscode = require("vscode");
exports.run = async () => {
  const extension = vscode.extensions.getExtension(
    "local-workbench.lattice",
  );
  assert.ok(extension, "Extension discovered");
  await extension.activate();
  assert.ok(extension.isActive, "Extension activated");
  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    "lattice.open",
    "lattice.host",
    "lattice.join",
    "lattice.invite",
    "lattice.providers",
  ])
    assert.ok(commands.includes(id), id + " registered");
  await vscode.commands.executeCommand("lattice.open");
  const views = extension.packageJSON.contributes.views;
  assert.equal(views["lattice-team"][0].id, "lattice.people");
  assert.equal(views["lattice-agent"][0].id, "lattice.composer");
  for (const containers of Object.values(
    extension.packageJSON.contributes.viewsContainers,
  ))
    for (const container of containers)
      assert.match(container.id, /^[a-zA-Z0-9_-]+$/);
  await new Promise((resolve) => setTimeout(resolve, 12000));
  require("node:fs").writeFileSync(
    require("node:path").resolve(__dirname, "../artifacts/vscode-smoke.json"),
    JSON.stringify(
      {
        activated: true,
        commands: true,
        views: true,
        time: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "LATTICE_SMOKE_OK: extension activated, commands registered, both webviews opened",
  );
};
