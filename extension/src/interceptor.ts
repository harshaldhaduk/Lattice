import * as vscode from 'vscode';
import { LatticeClient } from './client';
import { SidebarProvider } from './sidebar';

export class ConflictInterceptor implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private client: LatticeClient, private sidebar: SidebarProvider) {
    this.disposables.push(
      vscode.workspace.onWillSaveTextDocument(e => this.onWillSave(e))
    );
  }

  private onWillSave(event: vscode.TextDocumentWillSaveEvent): void {
    if (!this.client.isConnected()) return;

    const state = this.client.getState();
    if (!state) return;

    const relPath = vscode.workspace.asRelativePath(event.document.uri);

    // Find an active intent from this participant that covers this file
    const myIntent = state.intents.find(
      i => i.participantId === this.client.participantId &&
           i.status === 'in_progress' &&
           (i.fileScope.length === 0 || i.fileScope.some(f => relPath.includes(f) || f.includes(relPath)))
    );

    // Check if any OTHER participant has an active intent covering this file
    const conflictingIntents = state.intents.filter(
      i => i.participantId !== this.client.participantId &&
           i.status === 'in_progress' &&
           i.fileScope.some(f => relPath.includes(f) || f.includes(relPath))
    );

    if (conflictingIntents.length === 0) return;

    // Warn the user — the actual check/stage happens via the banner actions
    const names = conflictingIntents.map(i => i.participantName).join(', ');
    const tasks = conflictingIntents.map(i => `"${i.description}"`).join(', ');

    event.waitUntil(
      vscode.window.showWarningMessage(
        `⚠ Lattice: ${names} is working in this file (${tasks})`,
        { modal: false },
        'Stage as Shadow Patch',
        'Check Conflict',
        'Override & Save'
      ).then(async choice => {
        if (choice === 'Stage as Shadow Patch') {
          const intentId = myIntent?.id ?? 'no-intent';
          const diff = `// Staged by ${this.client.participantName} on save`;
          await this.client.proposePatch(intentId, relPath, diff, `Saving ${relPath} while ${names} has an active intent on this file`);
          this.sidebar.refresh();
          // Cancel the save — the patch is staged instead
          // (In production you'd return a TextEdit[] to vscode to suppress the save)
          vscode.window.showInformationMessage('Change staged as shadow patch. Your teammates can approve it.');
        } else if (choice === 'Check Conflict') {
          const intentId = myIntent?.id ?? 'no-intent';
          const verdict = await this.client.checkEdit(intentId, relPath, '', []);
          vscode.window.showInformationMessage(`Verdict: ${verdict.verdict} — ${verdict.message}`);
        }
        // 'Override & Save' or dismissed → save proceeds normally
      })
    );
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
