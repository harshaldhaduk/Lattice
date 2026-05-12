import * as vscode from 'vscode';
import { LatticeClient } from './client';
import { SidebarProvider } from './sidebar';

export class ConflictInterceptor implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private client: LatticeClient, private sidebar: SidebarProvider) {
    this.disposables.push(
      vscode.workspace.onWillSaveTextDocument(e => this.onWillSave(e)),
    );
  }

  private onWillSave(event: vscode.TextDocumentWillSaveEvent): void {
    if (!this.client.isConnected()) return;

    const state = this.client.getState();
    if (!state) return;

    const relPath = vscode.workspace.asRelativePath(event.document.uri);

    // Find the caller's own intent for this file (for staging context)
    const myIntent = state.intents.find(
      i => i.participantId === this.client.participantId &&
           i.status === 'in_progress' &&
           (i.filePaths.length === 0 || i.filePaths.some(f => relPath.includes(f) || f.includes(relPath))),
    );

    // Other participants' active intents that overlap this file
    const conflictingIntents = state.intents.filter(
      i => i.participantId !== this.client.participantId &&
           i.status === 'in_progress' &&
           i.filePaths.some(f => relPath.includes(f) || f.includes(relPath)),
    );

    if (conflictingIntents.length === 0) return;

    const names = conflictingIntents.map(i => i.participantName).join(', ');
    const tasks = conflictingIntents.map(i => `"${i.description}"`).join(', ');

    event.waitUntil(
      vscode.window.showWarningMessage(
        `Lattice: ${names} is working in this file (${tasks})`,
        { modal: false },
        'Stage as Shadow Patch',
        'Check Conflict',
        'Override & Save',
      ).then(async choice => {
        if (choice === 'Stage as Shadow Patch') {
          const intentId = myIntent?.id ?? conflictingIntents[0].id;
          const docText = event.document.getText();
          const lines = docText.split('\n');
          const diff = [
            `--- a/${relPath}`,
            `+++ b/${relPath}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map(l => `+${l}`),
          ].join('\n');
          await this.client.proposePatch(
            intentId, relPath, diff,
            `Save by ${this.client.participantName} while ${names} has an active intent on this file`,
          );
          this.sidebar.refresh();
          vscode.window.showInformationMessage('Change staged as shadow patch. Your teammates can approve it.');
        } else if (choice === 'Check Conflict') {
          const intentId = myIntent?.id ?? conflictingIntents[0].id;
          try {
            const verdict = await this.client.checkEdit(intentId, relPath, '');
            const label = verdict.verdict === 'SAFE' ? '✓ SAFE' : verdict.verdict === 'REVIEW' ? '⚠ REVIEW' : '✕ CONFLICT';
            vscode.window.showInformationMessage(`${label} — ${verdict.message}`);
          } catch {
            vscode.window.showErrorMessage('Could not reach Lattice server.');
          }
        }
        // 'Override & Save' or dismissed → save proceeds normally
      }),
    );
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
