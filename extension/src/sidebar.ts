import * as vscode from 'vscode';
import { LatticeClient } from './client';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private extensionUri: vscode.Uri,
    private client: LatticeClient,
  ) {
    client.onStateUpdate(() => this.refresh());
    client.onConflictDetected(() => this.refresh());
    client.onNegotiationEvent(() => this.refresh());
    client.onPatchPending(() => this.refresh());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'createSession':
          await vscode.commands.executeCommand('lattice.createSession');
          break;
        case 'joinSession':
          await vscode.commands.executeCommand('lattice.joinSession');
          break;
        case 'leaveSession':
          this.client.disconnect();
          this.refresh();
          vscode.window.showInformationMessage('Left Lattice session.');
          break;
        case 'plan': {
          const { prompt, autoRegister } = msg;
          if (!this.client.isConnected()) return;
          this.view?.webview.postMessage({ type: 'planning', loading: true });
          try {
            const result = await this.client.planWork(prompt, autoRegister);
            this.view?.webview.postMessage({ type: 'planResult', data: result });
            if (autoRegister) this.refresh();
          } catch (err) {
            this.view?.webview.postMessage({ type: 'planError', message: String(err) });
          }
          break;
        }
        case 'registerPlan': {
          // Register all specs from a previously-returned plan
          const { specs } = msg;
          if (!this.client.isConnected() || !specs?.length) return;
          try {
            for (const spec of specs) {
              await this.client.registerIntent(spec.description, spec.filePaths, spec.functionNames, {
                priority: spec.priority,
              });
            }
            vscode.window.showInformationMessage(`Registered ${specs.length} intents.`);
            this.refresh();
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to register: ${err}`);
          }
          break;
        }
        case 'approvePatch':
          await this.client.approvePatch(msg.patchId);
          break;
        case 'rejectPatch':
          await this.client.rejectPatch(msg.patchId);
          break;
        case 'getState': {
          this.sendState();
          break;
        }
      }
    });
  }

  refresh(): void {
    this.sendState();
  }

  private sendState(): void {
    const state = this.client.getState();
    // Use sessionId presence, not socket.connected — socket handshake is async
    const connected = !!(this.client.sessionId && this.client.participantId);
    this.view?.webview.postMessage({
      type: 'state',
      data: state,
      me: this.client.participantId,
      connected,
      sessionId: this.client.sessionId,
      participantName: this.client.participantName,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: 12px;
           color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
           height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

    /* ── Session header ── */
    .session-header { display: flex; align-items: center; justify-content: space-between;
                      padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border);
                      background: var(--vscode-sideBarSectionHeader-background); flex-shrink: 0; }
    .session-name   { font-weight: 700; font-size: 12px; white-space: nowrap; overflow: hidden;
                      text-overflow: ellipsis; max-width: 160px; }
    .session-meta   { font-size: 10px; opacity: 0.55; margin-top: 1px; }
    .btn-leave      { font-size: 10px; padding: 3px 8px; border-radius: 3px; cursor: pointer;
                      background: transparent; border: 1px solid var(--vscode-panel-border);
                      color: var(--vscode-foreground); opacity: 0.7; white-space: nowrap; }
    .btn-leave:hover { opacity: 1; border-color: var(--vscode-focusBorder); }

    /* ── Scroll container ── */
    .scroll { flex: 1; overflow-y: auto; }

    /* ── No-session landing ── */
    .landing { padding: 32px 16px; text-align: center; }
    .landing-logo { font-size: 28px; margin-bottom: 12px; }
    .landing h2 { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
    .landing p { opacity: 0.6; font-size: 11px; line-height: 1.6; margin-bottom: 20px; }
    .landing-btns { display: flex; flex-direction: column; gap: 8px; }

    /* ── Plan input ── */
    .plan-section { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .plan-label { font-size: 10px; font-weight: 600; text-transform: uppercase;
                  letter-spacing: 0.5px; opacity: 0.55; margin-bottom: 6px; }
    textarea { width: 100%; background: var(--vscode-input-background);
               color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
               border-radius: 3px; padding: 7px 9px; font-family: var(--vscode-font-family);
               font-size: 12px; resize: vertical; min-height: 68px; line-height: 1.5; }
    textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
    .plan-actions { display: flex; gap: 6px; margin-top: 7px; }

    /* ── Buttons ── */
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
             border: none; padding: 5px 12px; border-radius: 3px; cursor: pointer;
             font-size: 11px; font-family: var(--vscode-font-family); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button.secondary { background: var(--vscode-button-secondaryBackground);
                       color: var(--vscode-button-secondaryForeground); }
    button.full { width: 100%; padding: 8px; font-size: 12px; }
    button.ghost { background: transparent; border: 1px solid var(--vscode-panel-border);
                   color: var(--vscode-foreground); opacity: 0.8; }

    /* ── Plan result ── */
    .plan-result { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .plan-result-header { display: flex; justify-content: space-between; align-items: center;
                          margin-bottom: 8px; }
    .plan-result-title { font-size: 11px; font-weight: 600; opacity: 0.7; text-transform: uppercase;
                         letter-spacing: 0.4px; }
    .intent-card { border-radius: 4px; padding: 8px 10px; margin-bottom: 6px;
                   border-left: 3px solid transparent; background: var(--vscode-editor-inactiveSelectionBackground); }
    .intent-card.blocking  { border-left-color: #f14c4c; }
    .intent-card.normal    { border-left-color: #4fc1ff; }
    .intent-card.background{ border-left-color: #cca700; }
    .intent-desc   { font-size: 12px; font-weight: 500; margin-bottom: 4px; }
    .intent-files  { font-family: var(--vscode-editor-font-family); font-size: 10px;
                     opacity: 0.6; margin-bottom: 3px; word-break: break-all; }
    .intent-rationale { font-size: 10px; opacity: 0.5; font-style: italic; }
    .priority-pill { display: inline-block; font-size: 9px; font-weight: 700;
                     padding: 1px 6px; border-radius: 8px; margin-bottom: 4px;
                     text-transform: uppercase; letter-spacing: 0.4px; }
    .pill-blocking   { background: #4b1c1c; color: #f14c4c; }
    .pill-normal     { background: #1a2d4b; color: #4fc1ff; }
    .pill-background { background: #3a2f00; color: #cca700; }

    /* ── Tabs ── */
    .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
    .tab  { flex: 1; padding: 7px 2px; text-align: center; font-size: 10px; cursor: pointer;
            opacity: 0.5; user-select: none; }
    .tab.active { opacity: 1; border-bottom: 2px solid var(--vscode-focusBorder); }

    /* ── Tab content ── */
    .pane { display: none; padding: 8px; }
    .pane.active { display: block; }

    /* ── Cards ── */
    .card { background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px; padding: 8px; margin-bottom: 6px; }
    .card-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
    .card-title { font-weight: 600; font-size: 11px; flex: 1; }
    .card-sub   { font-size: 10px; opacity: 0.65; margin-top: 2px; }
    .files      { font-family: var(--vscode-editor-font-family); font-size: 10px;
                  opacity: 0.5; margin-top: 3px; word-break: break-all; }

    /* ── Badges ── */
    .badge { display: inline-block; padding: 1px 6px; border-radius: 10px;
             font-size: 9px; font-weight: 700; white-space: nowrap; }
    .badge-green  { background: #1a4731; color: #4ec994; }
    .badge-yellow { background: #3d3000; color: #e5c366; }
    .badge-red    { background: #4b1c1c; color: #f14c4c; }
    .badge-blue   { background: #1a2d4b; color: #4fc1ff; }

    /* ── Diff ── */
    .diff { font-family: monospace; font-size: 10px;
            background: var(--vscode-textBlockQuote-background);
            padding: 5px 7px; border-radius: 3px; white-space: pre-wrap;
            max-height: 60px; overflow: auto; margin-top: 4px; }

    /* ── Log ── */
    .log-entry { border-left: 2px solid var(--vscode-focusBorder); padding: 4px 8px;
                 margin-bottom: 4px; border-radius: 0 3px 3px 0;
                 background: var(--vscode-editor-inactiveSelectionBackground); }
    .log-entry .from { font-size: 9px; opacity: 0.5; margin-bottom: 1px; }
    .log-entry .msg  { font-size: 11px; }

    .empty { opacity: 0.4; font-style: italic; padding: 12px 0; text-align: center; font-size: 11px; }
    .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid transparent;
               border-top-color: currentColor; border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-msg { color: #f14c4c; font-size: 11px; margin-top: 6px; }
    .actor-chip { font-size: 9px; opacity: 0.5; margin-left: 3px; }
  </style>
</head>
<body>
  <div id="root"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = null;
    let me = null;
    let connected = false;
    let sessionId = null;
    let myName = null;
    let activeTab = 'overview';
    let planResult = null;
    let planning = false;
    let planError = null;

    vscode.postMessage({ command: 'getState' });

    document.addEventListener('click', e => {
      const el = e.target.closest('[data-cmd],[data-tab]');
      if (!el) return;
      const cmd = el.dataset.cmd;
      const tab = el.dataset.tab;
      const id  = el.dataset.id;
      if (tab) { activeTab = tab; render(); return; }
      if (!cmd) return;

      if (cmd === 'approvePatch' || cmd === 'rejectPatch') {
        vscode.postMessage({ command: cmd, patchId: id });
      } else if (cmd === 'registerPlan') {
        vscode.postMessage({ command: 'registerPlan', specs: planResult });
        planResult = null;
        render();
      } else if (cmd === 'clearPlan') {
        planResult = null; planError = null; render();
      } else {
        vscode.postMessage({ command: cmd });
      }
    });

    // Plan form submit
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const ta = document.getElementById('plan-input');
        if (document.activeElement === ta) submitPlan();
      }
    });

    function submitPlan() {
      const ta = document.getElementById('plan-input');
      const prompt = ta ? ta.value.trim() : '';
      if (!prompt) return;
      planning = true; planError = null; planResult = null;
      render();
      vscode.postMessage({ command: 'plan', prompt, autoRegister: false });
    }

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'state') {
        state     = msg.data;
        me        = msg.me;
        connected = msg.connected;
        sessionId = msg.sessionId;
        myName    = msg.participantName;
        render();
      } else if (msg.type === 'planning') {
        planning = true; render();
      } else if (msg.type === 'planResult') {
        planning = false;
        planResult = msg.data.specs;
        render();
      } else if (msg.type === 'planError') {
        planning = false;
        planError = msg.message;
        render();
      }
    });

    function render() {
      const root = document.getElementById('root');

      // ── Not connected ──────────────────────────────────────────────────────
      if (!connected) {
        root.innerHTML = \`
          <div class="scroll">
            <div class="landing">
              <div class="landing-logo">⬡</div>
              <h2>Lattice</h2>
              <p>AI-native coordination layer.<br>Plan work together, prevent conflicts,<br>ship faster.</p>
              <div class="landing-btns">
                <button class="full" data-cmd="createSession">Create Session</button>
                <button class="full secondary" data-cmd="joinSession">Join Existing Session</button>
              </div>
            </div>
          </div>\`;
        return;
      }

      const participants = state?.participants ?? [];
      const intents      = state?.intents ?? [];
      const patches      = state?.patches ?? [];
      const events       = state?.events  ?? [];

      const online      = participants.filter(p => p.status === 'online').length;
      const activeIn    = intents.filter(i => i.status === 'in_progress');
      const pendingPat  = patches.filter(p => p.status === 'pending');

      // ── Session header ─────────────────────────────────────────────────────
      const header = \`
        <div class="session-header">
          <div>
            <div class="session-name">⬡ \${state?.session?.name ?? 'Session'}</div>
            <div class="session-meta">\${online} online · \${activeIn.length} active · \${pendingPat.length} pending</div>
          </div>
          <button class="btn-leave" data-cmd="leaveSession">Leave</button>
        </div>\`;

      // ── Plan input section ─────────────────────────────────────────────────
      const planSection = \`
        <div class="plan-section">
          <div class="plan-label">What do you want to build?</div>
          <textarea id="plan-input" placeholder="e.g. Add OAuth login, refactor the auth middleware to support RS256 tokens, add a user profile page" rows="3"></textarea>
          <div class="plan-actions">
            <button \${planning ? 'disabled' : ''} id="plan-btn">
              \${planning ? '<span class="spinner"></span> Planning…' : '⚡ Generate Plan'}
            </button>
            <button class="secondary" data-cmd="registerIntent">+ Manual Intent</button>
          </div>
          \${planError ? \`<div class="error-msg">\${planError}</div>\` : ''}
        </div>\`;

      // ── Plan result ────────────────────────────────────────────────────────
      let planDisplay = '';
      if (planResult && planResult.length > 0) {
        const cards = planResult.map(s => \`
          <div class="intent-card \${s.priority}">
            <span class="priority-pill pill-\${s.priority}">\${s.priority}</span>
            <div class="intent-desc">\${s.description}</div>
            \${s.filePaths?.length ? \`<div class="intent-files">\${s.filePaths.join(' · ')}</div>\` : ''}
            \${s.rationale ? \`<div class="intent-rationale">\${s.rationale}</div>\` : ''}
          </div>
        \`).join('');

        planDisplay = \`
          <div class="plan-result">
            <div class="plan-result-header">
              <span class="plan-result-title">AI Task Plan (\${planResult.length} intents)</span>
              <div style="display:flex;gap:5px">
                <button data-cmd="registerPlan">Register All</button>
                <button class="ghost" style="font-size:10px;padding:3px 7px" data-cmd="clearPlan">✕</button>
              </div>
            </div>
            \${cards}
          </div>\`;
      }

      // ── Tabs ───────────────────────────────────────────────────────────────
      const tabDefs = [
        { id: 'overview', label: 'Team',    count: online },
        { id: 'intents',  label: 'Work',    count: activeIn.length },
        { id: 'patches',  label: 'Patches', count: pendingPat.length },
        { id: 'log',      label: 'Log',     count: 0 },
      ];

      const tabBar = \`<div class="tabs">\${tabDefs.map(t => \`
        <div class="tab \${activeTab === t.id ? 'active' : ''}" data-tab="\${t.id}">
          \${t.label}\${t.count > 0 ? \` <span style="font-size:9px;opacity:0.7">(\${t.count})</span>\` : ''}
        </div>\`).join('')}</div>\`;

      // ── Pane: Team ─────────────────────────────────────────────────────────
      const teamPane = \`
        <div class="pane \${activeTab === 'overview' ? 'active' : ''}">
          \${participants.length === 0 ? '<div class="empty">No participants yet</div>' : ''}
          \${participants.map(p => \`
            <div class="card">
              <div class="card-row">
                <span class="card-title">\${p.name}\${p.id === me ? ' <span style="opacity:0.4;font-weight:400">(you)</span>' : ''}<span class="actor-chip">[\${p.actorType}]</span></span>
                <span class="badge \${p.status === 'online' ? 'badge-green' : p.status === 'away' ? 'badge-yellow' : 'badge-red'}">\${p.status}</span>
              </div>
              \${p.currentTask ? \`<div class="card-sub">\${p.currentTask}</div>\` : ''}
            </div>
          \`).join('')}
        </div>\`;

      // ── Pane: Work ─────────────────────────────────────────────────────────
      const workPane = \`
        <div class="pane \${activeTab === 'intents' ? 'active' : ''}">
          \${activeIn.length === 0 ? '<div class="empty">No active work. Generate a plan above.</div>' : ''}
          \${activeIn.map(i => \`
            <div class="card" style="border-left: 3px solid \${i.priority === 'blocking' ? '#f14c4c' : i.priority === 'background' ? '#cca700' : '#4fc1ff'}">
              <div class="card-row">
                <span class="card-title">\${i.participantName}<span class="actor-chip">[\${i.actorType}]</span></span>
                <span class="badge \${i.priority === 'blocking' ? 'badge-red' : i.priority === 'background' ? 'badge-yellow' : 'badge-blue'}">\${i.priority}</span>
              </div>
              <div class="card-sub">\${i.description}</div>
              \${i.filePaths?.length ? \`<div class="files">\${i.filePaths.join(' · ')}</div>\` : ''}
            </div>
          \`).join('')}
          \${intents.filter(i => i.status !== 'in_progress').length > 0 ? \`
            <div style="opacity:0.35;font-size:10px;margin:8px 0 4px">DONE</div>
            \${intents.filter(i => i.status !== 'in_progress').map(i => \`
              <div class="card" style="opacity:0.45">
                <div class="card-row">
                  <span class="card-title">\${i.description}</span>
                  <span class="badge badge-yellow">\${i.status}</span>
                </div>
              </div>
            \`).join('')}
          \` : ''}
        </div>\`;

      // ── Pane: Patches ──────────────────────────────────────────────────────
      const patchPane = \`
        <div class="pane \${activeTab === 'patches' ? 'active' : ''}">
          \${pendingPat.length === 0 ? '<div class="empty">No pending patches</div>' : ''}
          \${pendingPat.map(p => \`
            <div class="card" style="border-left: 3px solid #cca700">
              <div class="card-row">
                <span class="card-title">\${p.filePath}</span>
                <span class="badge badge-yellow">pending</span>
              </div>
              <div class="card-sub">by \${p.proposerName}</div>
              <div class="card-sub" style="margin-top:2px">\${p.reason}</div>
              <div class="diff">\${p.diff.substring(0, 250)}\${p.diff.length > 250 ? '…' : ''}</div>
              <div style="margin-top:5px">
                <button data-cmd="approvePatch" data-id="\${p.id}">Approve</button>
                <button class="secondary" data-cmd="rejectPatch" data-id="\${p.id}">Reject</button>
              </div>
            </div>
          \`).join('')}
        </div>\`;

      // ── Pane: Log ──────────────────────────────────────────────────────────
      const logPane = \`
        <div class="pane \${activeTab === 'log' ? 'active' : ''}">
          \${events.length === 0 ? '<div class="empty">No events yet</div>' : ''}
          \${[...events].reverse().slice(0, 40).map(ev => \`
            <div class="log-entry">
              <div class="from">\${ev.actorName}\${ev.targetName ? \` → \${ev.targetName}\` : ''} · \${fmt(ev.createdAt)} · \${ev.eventType}</div>
              <div class="msg">\${ev.message}</div>
            </div>
          \`).join('')}
        </div>\`;

      root.innerHTML = header + \`<div class="scroll">\` + planSection + planDisplay + tabBar + teamPane + workPane + patchPane + logPane + \`</div>\`;

      // Re-attach plan button (inside innerHTML so onclick won't work — use id)
      const planBtn = document.getElementById('plan-btn');
      if (planBtn) planBtn.addEventListener('click', submitPlan);
    }

    function fmt(iso) {
      try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
      catch { return ''; }
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
