import * as vscode from 'vscode';
import { LatticeClient } from './client';
import { SidebarProvider } from './sidebar';
import { ConflictInterceptor } from './interceptor';

let client: LatticeClient | undefined;
let interceptor: ConflictInterceptor | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Lattice extension activated');

  const serverUrl = vscode.workspace.getConfiguration('lattice').get<string>('serverUrl', 'http://localhost:3001');
  client = new LatticeClient(serverUrl);

  const sidebarProvider = new SidebarProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lattice.sidebarView', sidebarProvider)
  );

  interceptor = new ConflictInterceptor(client, sidebarProvider);
  context.subscriptions.push(interceptor);

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('lattice.createSession', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Session name', value: 'My Lattice Session' });
      if (!name) return;
      const participantName = await vscode.window.showInputBox({ prompt: 'Your name' });
      if (!participantName) return;

      try {
        await client!.createAndJoinSession(name, participantName);
        vscode.window.showInformationMessage(`Lattice session created! Code: ${client!.sessionId}`);
        sidebarProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to create session: ${err}`);
      }
    }),

    vscode.commands.registerCommand('lattice.joinSession', async () => {
      const sessionId = await vscode.window.showInputBox({ prompt: 'Session code' });
      if (!sessionId) return;
      const participantName = await vscode.window.showInputBox({ prompt: 'Your name' });
      if (!participantName) return;

      try {
        await client!.joinSession(sessionId, participantName);
        vscode.window.showInformationMessage('Joined Lattice session!');
        sidebarProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to join session: ${err}`);
      }
    }),

    vscode.commands.registerCommand('lattice.registerIntent', async () => {
      if (!client!.isConnected()) {
        vscode.window.showWarningMessage('Join a Lattice session first.');
        return;
      }
      const description = await vscode.window.showInputBox({ prompt: 'What are you working on?' });
      if (!description) return;

      const filesInput = await vscode.window.showInputBox({
        prompt: 'Which files will you touch? (comma-separated, relative paths)',
        placeHolder: 'src/auth/middleware.ts, src/auth/types.ts',
      });
      const fileScope = filesInput ? filesInput.split(',').map(f => f.trim()).filter(Boolean) : [];

      try {
        await client!.registerIntent(description, fileScope, []);
        vscode.window.showInformationMessage('Intent registered!');
        sidebarProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to register intent: ${err}`);
      }
    }),

    vscode.commands.registerCommand('lattice.endSession', () => {
      client!.disconnect();
      sidebarProvider.refresh();
      vscode.window.showInformationMessage('Lattice session ended.');
    })
  );
}

export function deactivate() {
  interceptor?.dispose();
  client?.disconnect();
}
