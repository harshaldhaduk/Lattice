import * as vscode from 'vscode';
import { LatticeClient } from './client';
import { SidebarProvider } from './sidebar';
import { ConflictInterceptor } from './interceptor';

let client: LatticeClient | undefined;
let interceptor: ConflictInterceptor | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Lattice extension activated');

  const serverUrl = vscode.workspace
    .getConfiguration('lattice')
    .get<string>('serverUrl', 'http://localhost:3001');

  client = new LatticeClient(serverUrl);

  // ── Status bar ─────────────────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'lattice.createSession';
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  client.onStateUpdate(() => updateStatusBar());

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lattice.sidebarView', sidebarProvider),
  );

  // ── Conflict interceptor ───────────────────────────────────────────────────
  interceptor = new ConflictInterceptor(client, sidebarProvider);
  context.subscriptions.push(interceptor);

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.createSession', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Session name',
        value: 'My Lattice Session',
      });
      if (!name) return;

      const participantName = await vscode.window.showInputBox({ prompt: 'Your name' });
      if (!participantName) return;

      const actorChoice = await vscode.window.showQuickPick(
        [{ label: 'Human', value: 'human' }, { label: 'AI Agent', value: 'agent' }],
        { placeHolder: 'Participant type' },
      );

      try {
        await client!.createAndJoinSession(name, participantName, (actorChoice?.value ?? 'human') as 'human' | 'agent');
        updateStatusBar();
        sidebarProvider.refresh();
        vscode.window.showInformationMessage(
          `Lattice session created! Share code: ${client!.sessionId}`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to create session: ${err}`);
      }
    }),

    vscode.commands.registerCommand('lattice.joinSession', async () => {
      const sessionId = await vscode.window.showInputBox({ prompt: 'Session code' });
      if (!sessionId) return;

      const participantName = await vscode.window.showInputBox({ prompt: 'Your name' });
      if (!participantName) return;

      const actorChoice = await vscode.window.showQuickPick(
        [{ label: 'Human', value: 'human' }, { label: 'AI Agent', value: 'agent' }],
        { placeHolder: 'Participant type' },
      );

      try {
        await client!.joinSession(sessionId, participantName, (actorChoice?.value ?? 'human') as 'human' | 'agent');
        updateStatusBar();
        sidebarProvider.refresh();
        vscode.window.showInformationMessage('Joined Lattice session!');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to join session: ${err}`);
      }
    }),

    vscode.commands.registerCommand('lattice.registerIntent', async () => {
      if (!client!.isConnected()) {
        vscode.window.showWarningMessage('Join a Lattice session first.');
        return;
      }

      const description = await vscode.window.showInputBox({
        prompt: 'What are you working on?',
        placeHolder: 'Refactoring auth middleware',
      });
      if (!description) return;

      const filesInput = await vscode.window.showInputBox({
        prompt: 'Which files will you touch? (comma-separated, relative paths)',
        placeHolder: 'src/auth/middleware.ts, src/auth/types.ts',
      });
      const filePaths = filesInput
        ? filesInput.split(',').map(f => f.trim()).filter(Boolean)
        : [];

      const fnInput = await vscode.window.showInputBox({
        prompt: 'Function names you will modify? (optional, comma-separated)',
        placeHolder: 'verifyToken, createSession',
      });
      const functionNames = fnInput
        ? fnInput.split(',').map(f => f.trim()).filter(Boolean)
        : [];

      const priorityChoice = await vscode.window.showQuickPick(
        [
          { label: 'Normal', value: 'normal' },
          { label: 'Blocking', value: 'blocking' },
          { label: 'Background', value: 'background' },
        ],
        { placeHolder: 'Intent priority' },
      );

      try {
        await client!.registerIntent(description, filePaths, functionNames, {
          priority: (priorityChoice?.value ?? 'normal') as 'blocking' | 'normal' | 'background',
        });
        updateStatusBar();
        sidebarProvider.refresh();
        vscode.window.showInformationMessage('Intent registered!');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to register intent: ${err}`);
      }
    }),

    vscode.commands.registerCommand('lattice.endSession', () => {
      client!.disconnect();
      updateStatusBar();
      sidebarProvider.refresh();
      vscode.window.showInformationMessage('Lattice session ended.');
    }),
  );
}

export function deactivate() {
  interceptor?.dispose();
  client?.disconnect();
  statusBarItem?.dispose();
}

// ── Status bar helpers ────────────────────────────────────────────────────────

function updateStatusBar() {
  if (!statusBarItem) return;

  if (!client?.isConnected()) {
    statusBarItem.text = '$(broadcast) Lattice';
    statusBarItem.tooltip = 'Click to create a Lattice session';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  const state = client.getState();
  const online = state?.participants.filter(p => p.status === 'online').length ?? 0;
  const activeIntents = state?.intents.filter(i => i.status === 'in_progress').length ?? 0;
  const pendingPatches = state?.patches.filter(p => p.status === 'pending').length ?? 0;

  statusBarItem.text = `$(broadcast) Lattice ${online} online`;
  statusBarItem.tooltip = [
    `Session: ${client.sessionId}`,
    `You: ${client.participantName}`,
    `Active intents: ${activeIntents}`,
    `Pending patches: ${pendingPatches}`,
  ].join('\n');

  if (pendingPatches > 0) {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.backgroundColor = undefined;
  }
}
