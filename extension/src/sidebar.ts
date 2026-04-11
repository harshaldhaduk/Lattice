import * as vscode from 'vscode';
import { LatticeClient } from './client';
import { SessionState, ShadowPatch } from '@lattice/shared';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private extensionUri: vscode.Uri,
    private client: LatticeClient
  ) {
    client.onStateUpdate(() => this.refresh());
    client.onConflictDetected((data) => {
      this.view?.webview.postMessage({ type: 'conflict', data });
    });
    client.onNegotiationMessage((msg) => {
      this.view?.webview.postMessage({ type: 'negotiation', data: msg });
    });
    client.onPatchPending((patch) => {
      this.view?.webview.postMessage({ type: 'patch', data: patch });
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'createSession': {
          await vscode.commands.executeCommand('lattice.createSession');
          break;
        }
        case 'joinSession': {
          await vscode.commands.executeCommand('lattice.joinSession');
          break;
        }
        case 'registerIntent': {
          await vscode.commands.executeCommand('lattice.registerIntent');
          break;
        }
        case 'approvePatch': {
          await this.client.approvePatch(msg.patchId);
          break;
        }
        case 'rejectPatch': {
          await this.client.rejectPatch(msg.patchId);
          break;
        }
        case 'getState': {
          const state = this.client.getState();
          webviewView.webview.postMessage({ type: 'state', data: state });
          break;
        }
      }
    });
  }

  refresh(): void {
    const state = this.client.getState();
    this.view?.webview.postMessage({
      type: 'state',
      data: state,
      me: this.client.participantId,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); padding: 8px; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; margin: 12px 0 6px; }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .badge-green { background: #1a4731; color: #4ec994; }
    .badge-yellow { background: #3d3000; color: #e5c366; }
    .badge-red { background: #4b1c1c; color: #f14c4c; }
    .badge-blue { background: #1a2d4b; color: #4fc1ff; }
    .card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; padding: 8px; margin-bottom: 6px; }
    .card-title { font-weight: 600; margin-bottom: 3px; }
    .card-sub { opacity: 0.7; font-size: 11px; }
    .files { font-family: var(--vscode-editor-font-family); font-size: 10px; opacity: 0.6; margin-top: 3px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
             border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-right: 4px; margin-top: 4px; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .empty { opacity: 0.5; font-style: italic; padding: 8px 0; }
    #no-session { padding: 16px 0; text-align: center; }
    #no-session p { opacity: 0.7; margin-bottom: 12px; }
    .neg-msg { background: var(--vscode-editor-inactiveSelectionBackground); border-left: 2px solid #4fc1ff;
               padding: 6px 8px; margin-bottom: 4px; border-radius: 0 4px 4px 0; }
    .neg-msg .from { font-size: 10px; opacity: 0.6; margin-bottom: 2px; }
    .diff { font-family: monospace; font-size: 10px; background: var(--vscode-textBlockQuote-background);
            padding: 6px; border-radius: 3px; white-space: pre-wrap; max-height: 80px; overflow: auto; }
  </style>
</head>
<body>
  <div id="root"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = null;
    let me = null;
    let negotiationLog = [];

    vscode.postMessage({ command: 'getState' });

    window.addEventListener('message', e => {
      const { type, data } = e.data;
      if (type === 'state') {
        state = data;
        me = e.data.me;
        render();
      } else if (type === 'negotiation') {
        negotiationLog.unshift(data);
        if (negotiationLog.length > 20) negotiationLog.pop();
        render();
      } else if (type === 'conflict') {
        // Flash the UI — state will refresh via server
        render();
      }
    });

    function render() {
      const root = document.getElementById('root');
      if (!state) {
        root.innerHTML = \`
          <div id="no-session">
            <p>No active session</p>
            <button onclick="vscode.postMessage({command:'createSession'})">Create Session</button>
            <button class="secondary" onclick="vscode.postMessage({command:'joinSession'})">Join Session</button>
          </div>\`;
        return;
      }

      const { participants, intents, patches } = state;
      const activeIntents = intents.filter(i => i.status === 'in_progress');
      const pendingPatches = patches.filter(p => p.status === 'pending');

      root.innerHTML = \`
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:600;font-size:13px">Lattice</span>
          <span class="badge badge-green">\${participants.filter(p=>p.status==='online').length} online</span>
        </div>

        <button onclick="vscode.postMessage({command:'registerIntent'})" style="width:100%;margin-bottom:12px">
          + Register Intent
        </button>

        <h3>Presence (\${participants.length})</h3>
        \${participants.map(p => \`
          <div class="card">
            <div style="display:flex;justify-content:space-between">
              <span class="card-title">\${p.name}\${p.id===me?' (you)':''}</span>
              <span class="badge \${p.status==='online'?'badge-green':'badge-yellow'}">\${p.status}</span>
            </div>
            \${p.currentTask ? \`<div class="card-sub">\${p.currentTask}</div>\` : ''}
          </div>
        \`).join('')}

        <h3>Active Intents (\${activeIntents.length})</h3>
        \${activeIntents.length === 0 ? '<div class="empty">No active intents</div>' : ''}
        \${activeIntents.map(i => \`
          <div class="card">
            <div style="display:flex;justify-content:space-between">
              <span class="card-title">\${i.participantName}</span>
              <span class="badge badge-blue">\${i.priority}</span>
            </div>
            <div class="card-sub">\${i.description}</div>
            \${i.fileScope.length ? \`<div class="files">\${i.fileScope.join(', ')}</div>\` : ''}
          </div>
        \`).join('')}

        <h3>Shadow Patches (\${pendingPatches.length})</h3>
        \${pendingPatches.length === 0 ? '<div class="empty">No pending patches</div>' : ''}
        \${pendingPatches.map(p => \`
          <div class="card">
            <div class="card-title">\${p.filePath}</div>
            <div class="card-sub">by \${p.proposerName}</div>
            <div class="card-sub" style="margin-top:3px">\${p.reason}</div>
            <div class="diff">\${p.diff.substring(0, 200)}\${p.diff.length>200?'...':''}</div>
            <div>
              <button onclick="vscode.postMessage({command:'approvePatch',patchId:'\${p.id}'})">Approve</button>
              <button class="secondary" onclick="vscode.postMessage({command:'rejectPatch',patchId:'\${p.id}'})">Reject</button>
            </div>
          </div>
        \`).join('')}

        <h3>Negotiation Log</h3>
        \${negotiationLog.length === 0 && (!state.negotiationLog || state.negotiationLog.length === 0)
          ? '<div class="empty">No negotiations yet</div>'
          : (state.negotiationLog || []).slice(0,8).map(m => \`
            <div class="neg-msg">
              <div class="from">\${m.fromParticipantId} → \${m.toParticipantId}</div>
              <div>\${m.message}</div>
            </div>
          \`).join('')}
      \`;
    }

    render();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
