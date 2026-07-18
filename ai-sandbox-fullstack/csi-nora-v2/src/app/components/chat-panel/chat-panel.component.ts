import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, computed } from '@angular/core';
import { CommonModule }    from '@angular/common';
import { FormsModule }     from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject, takeUntil } from 'rxjs';
import { StateService }    from '../../services/state.service';
import { ApiService }      from '../../services/api.service';
import { AuditService }    from '../../services/audit.service';
import { RagService }      from '../../services/rag.service';
import { EmbeddingService }from '../../services/embedding.service';
import { ChatMessage, RetrievedChunk } from '../../models';
import { SECTORS }         from '../../data/sectors.data';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="cp">

  <!-- Sector hero -->
  <div class="hero" *ngIf="sector()">
    <div class="hero-icon">{{ S[sector()!].icon }}</div>
    <div class="hero-info">
      <h2>{{ S[sector()!].name }}</h2>
      <p>{{ S[sector()!].desc }}</p>
      <div class="service-tags">
        <span *ngFor="let sv of S[sector()!].services"
          class="stag" [style.color]="sv.color" [style.background]="sv.bg"
          [style.border-color]="sv.color+'40'">{{ sv.tag }}</span>
      </div>
    </div>
  </div>

  <!-- Mode + RAG bar -->
  <div class="mode-bar" [ngClass]="modeBarCls()">
    <span>{{ modeBarIcon() }}</span>
    <span class="mb-text" [innerHTML]="modeBarText()"></span>
    <span *ngIf="rag.totalChunks > 0" class="rag-count-badge">
      🧠 {{ rag.totalChunks }} chunks indexed
    </span>
    <button class="recheck-btn" (click)="recheck()">↺ Recheck</button>
  </div>

  <!-- Embed progress bar -->
  <div class="embed-progress" *ngIf="embedSvc.status()==='loading'">
    <div class="embed-spinner"></div>
    <span>Indexing embeddings {{ embedSvc.progress() }}% — RAG will activate when complete</span>
  </div>

  <!-- Messages -->
  <div class="chat-msgs" #msgContainer>

    <!-- Welcome -->
    <div class="welcome" *ngIf="!sector() && !msgs.length">
      <div class="wl">N</div>
      <h3>Hi, I'm Nora</h3>
      <p>Singtel CSI enterprise portfolio advisor with Hybrid RAG.<br>
         Upload documents → ask questions → get grounded answers with citations.</p>
      <div class="wchips">
        <div *ngFor="let c of chips" class="wchip" (click)="pick(c.k)">{{ c.label }}</div>
      </div>
    </div>

    <!-- Messages -->
    <ng-container *ngFor="let m of msgs; trackBy: trackId">
      <div class="msg" [ngClass]="m.role">
        <div class="avatar">{{ m.role==='nora' ? 'N' : '👤' }}</div>
        <div class="msg-body">
          <div class="msg-name">
            {{ m.role==='nora' ? 'Nora · '+api.provLabel : (st.role()|titlecase) }}
            <span *ngIf="m.timestamp" class="msg-ts">{{ fmtTime(m.timestamp) }}</span>
          </div>
          <div class="msg-bubble" [innerHTML]="fmt(m.content)"></div>

          <!-- RAG source chips -->
          <div class="src-row" *ngIf="m.docSources?.length">
            📚
            <span *ngFor="let s of m.docSources" class="src-chip">{{ s }}</span>
          </div>

          <!-- Mode tag -->
          <div *ngIf="m.role==='nora' && m.apiMode">
            <span class="msg-mode-tag" [ngClass]="m.apiMode==='hybrid' ? 'mm-hybrid' : 'mm-local'">
              {{ m.apiMode==='hybrid' ? '🟢 Hybrid RAG · Dense + Sparse + RRF' : '🟡 Local KB' }}
            </span>
          </div>

          <!-- RAG chunks (expandable) -->
          <div *ngIf="m.ragChunks?.length">
            <button class="chunks-toggle" (click)="toggle(m.id)">
              {{ expanded.has(m.id) ? '▲' : '▼' }}
              {{ m.ragChunks!.length }} retrieved chunk{{ m.ragChunks!.length!==1?'s':'' }}
            </button>
            <div *ngIf="expanded.has(m.id)" class="chunks-panel">
              <div *ngFor="let r of m.ragChunks" class="rag-chunk">
                <div class="rag-chunk-header">
                  <span class="src-chip">{{ r.chunk.docName }}</span>
                  <div class="rag-score-bar">
                    <span>H:{{ r.hybridScore.toFixed(3) }}</span>
                    <span *ngIf="r.denseScore>0" style="color:var(--blue)"> D:{{ r.denseScore.toFixed(3) }}</span>
                    <span *ngIf="r.sparseScore>0" style="color:var(--amber)"> S:{{ r.sparseScore.toFixed(3) }}</span>
                    <div class="rag-score-fill" [style.width.px]="r.hybridScore*60"></div>
                  </div>
                </div>
                <div class="rag-chunk-text">{{ r.chunk.content }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ng-container>

    <!-- Typing -->
    <div class="msg nora" *ngIf="st.isLoading()">
      <div class="avatar">N</div>
      <div class="msg-body">
        <div class="msg-name">Nora · {{ api.provLabel }}</div>
        <div class="msg-bubble">
          <div class="typing">
            <div class="td"></div><div class="td"></div><div class="td"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Banners -->
    <div *ngFor="let b of banners; trackBy: trackBanner" class="info-banner">{{ b.text }}</div>

    <div #bottom></div>
  </div>

  <!-- Input area -->
  <div class="input-area">
    <div class="toolbar">
      <div class="ti" [class.active]="st.useRag()" (click)="toggleRag()">
        🧠 RAG
        <span class="ti-badge" [class.on]="st.useRag()">{{ st.useRag()?'ON':'OFF' }}</span>
      </div>
      <div class="ti" (click)="st.activeModal.set('rag-config')">⚙️ RAG Config</div>
      <div class="ti" (click)="st.activeModal.set('portability')">📥 Export</div>
      <div class="ti" (click)="copyTranscript()">📋 Copy</div>
      <span class="tc">{{ tokenCount() }}</span>
    </div>

    <!-- Quick prompts -->
    <div class="qps" *ngIf="quickPrompts().length">
      <button *ngFor="let q of quickPrompts()" class="qp" (click)="quickSend(q)">💬 {{ q }}</button>
    </div>

    <div class="input-row">
      <div class="input-box">
        <textarea #ta [(ngModel)]="inputText" rows="1"
          placeholder="Ask Nora — documents will be searched via Hybrid RAG…"
          (keydown)="onKey($event)" (input)="resize($any($event.target))"></textarea>
      </div>
      <button class="send-btn" [disabled]="st.isLoading() || !inputText.trim()" (click)="send()">➤</button>
    </div>
  </div>
</div>
  `,
  styles: [`
    :host{display:contents}
    .cp{display:flex;flex-direction:column;background:var(--dark);overflow:hidden}
    .hero{padding:14px 24px 10px;border-bottom:1px solid var(--border);
      background:linear-gradient(135deg,rgba(224,0,26,.04) 0%,transparent 60%);
      display:flex;align-items:flex-start;gap:14px;flex-shrink:0}
    .hero-icon{width:44px;height:44px;border-radius:12px;
      background:linear-gradient(135deg,var(--red),var(--red-deep));
      display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;
      box-shadow:0 4px 16px var(--red-glow)}
    .hero-info h2{font-family:var(--fd);font-size:17px;font-weight:700}
    .hero-info p{font-size:11px;color:var(--muted);margin-top:2px}
    .service-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
    .stag{padding:2px 7px;border-radius:20px;font-size:10px;font-weight:500;border:1px solid}
    .mode-bar{display:flex;align-items:center;gap:7px;padding:6px 14px;
      border-bottom:1px solid var(--border);font-size:11px;flex-shrink:0}
    .mode-bar.hybrid{background:rgba(34,197,94,.04)}
    .mode-bar.local{background:rgba(245,158,11,.05)}
    .mode-bar.checking{background:rgba(59,130,246,.04)}
    .mb-text{flex:1}
    .rag-count-badge{background:rgba(59,130,246,.1);color:var(--blue);border:1px solid rgba(59,130,246,.2);
      padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600}
    .recheck-btn{background:transparent;border:1px solid var(--border);color:var(--dim);
      font-size:10px;padding:2px 7px;border-radius:5px;cursor:pointer;font-family:var(--fb);
      &:hover{border-color:var(--border-a);color:var(--text)}}
    .chat-msgs{flex:1;overflow-y:auto;padding:18px 24px;display:flex;flex-direction:column;
      gap:16px;scroll-behavior:smooth}
    .welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
      text-align:center;padding:40px;gap:14px}
    .wl{width:60px;height:60px;background:linear-gradient(135deg,var(--red),var(--red-deep));
      border-radius:18px;display:flex;align-items:center;justify-content:center;
      font-family:var(--fd);font-size:24px;font-weight:800;color:#fff;
      box-shadow:0 8px 32px var(--red-glow);animation:float 3s ease-in-out infinite;position:relative;
      &::after{content:'';position:absolute;inset:-4px;border-radius:22px;
        border:2px solid var(--red);opacity:.3;animation:ring 2s ease-out infinite}}
    .welcome h3{font-family:var(--fd);font-size:20px;font-weight:700}
    .welcome p{font-size:12px;color:var(--muted);line-height:1.6;max-width:360px}
    .wchips{display:flex;flex-wrap:wrap;gap:7px;justify-content:center}
    .wchip{padding:5px 12px;border-radius:20px;border:1px solid var(--border);color:var(--muted);
      font-size:11px;cursor:pointer;background:var(--card);transition:.2s;
      &:hover{border-color:var(--border-a);color:var(--text)}}
    .msg{display:flex;gap:10px;animation:fadeUp .3s ease}
    .msg.user{flex-direction:row-reverse}
    .avatar{width:32px;height:32px;border-radius:10px;flex-shrink:0;display:flex;
      align-items:center;justify-content:center;font-size:14px;font-weight:700}
    .msg.nora .avatar{background:linear-gradient(135deg,var(--red),var(--red-deep));
      color:#fff;font-family:var(--fd);font-size:12px;box-shadow:0 0 12px var(--red-glow)}
    .msg.user .avatar{background:var(--card);border:1px solid var(--border);color:var(--muted)}
    .msg-body{max-width:80%}
    .msg-name{font-size:10px;color:var(--muted);margin-bottom:4px;font-weight:500;display:flex;align-items:center;gap:6px}
    .msg.user .msg-name{flex-direction:row-reverse}
    .msg-ts{color:var(--dim);font-size:9px}
    .msg-bubble{padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.65;font-weight:300}
    .msg.nora .msg-bubble{background:var(--card);border:1px solid var(--border);border-radius:4px 14px 14px 14px}
    .msg.user .msg-bubble{background:linear-gradient(135deg,var(--red),var(--red-deep));color:#fff;border-radius:14px 4px 14px 14px}
    .msg-bubble ::ng-deep strong{color:#fff;font-weight:600}
    .msg-bubble ::ng-deep ul{padding-left:16px;margin-top:6px}
    .msg-bubble ::ng-deep li{margin-bottom:4px}
    .msg-bubble ::ng-deep code{background:rgba(255,255,255,.08);padding:1px 4px;border-radius:3px;font-size:11px}
    .src-row{display:flex;align-items:center;gap:5px;margin-top:5px;font-size:10px;color:var(--muted);flex-wrap:wrap}
    .src-chip{padding:1px 6px;border-radius:10px;background:rgba(59,130,246,.1);color:var(--blue);
      border:1px solid rgba(59,130,246,.2);font-size:9px;font-weight:600}
    .chunks-toggle{margin-top:5px;background:transparent;border:1px solid var(--border);color:var(--dim);
      font-size:10px;padding:2px 8px;border-radius:5px;cursor:pointer;font-family:var(--fb);
      transition:.15s;&:hover{border-color:var(--blue);color:var(--blue)}}
    .chunks-panel{margin-top:6px;display:flex;flex-direction:column;gap:5px}
    .typing{display:flex;gap:4px;align-items:center;padding:4px 0}
    .td{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:bounce3 1.2s infinite;
      &:nth-child(2){animation-delay:.2s}&:nth-child(3){animation-delay:.4s}}
    .input-area{padding:10px 24px 14px;border-top:1px solid var(--border);background:rgba(10,10,15,.8);flex-shrink:0}
    .toolbar{display:flex;align-items:center;gap:7px;margin-bottom:7px;flex-wrap:wrap}
    .ti{display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;
      border:1px solid var(--border);background:var(--surface);font-size:10px;color:var(--muted);
      cursor:pointer;transition:.15s;&:hover{border-color:var(--border-a);color:var(--text)}
      &.active{border-color:rgba(59,130,246,.4);color:var(--blue);background:rgba(59,130,246,.08)}}
    .ti-badge{font-size:9px;padding:0 4px;border-radius:3px;background:rgba(224,0,26,.15);color:var(--red);
      &.on{background:rgba(34,197,94,.15);color:var(--green)}}
    .tc{margin-left:auto;font-size:10px;color:var(--dim)}
    .qps{display:flex;gap:5px;margin-bottom:8px;flex-wrap:wrap}
    .qp{padding:3px 9px;border-radius:20px;border:1px solid var(--border);background:var(--card);
      color:var(--muted);font-size:11px;cursor:pointer;font-family:var(--fb);transition:.15s;
      &:hover{border-color:var(--border-a);color:var(--text)}}
    .input-row{display:flex;gap:7px;align-items:flex-end}
    .input-box{flex:1;background:var(--card);border:1px solid var(--border);border-radius:12px;
      overflow:hidden;transition:.2s;&:focus-within{border-color:var(--border-a)}}
    .input-box textarea{width:100%;padding:10px 14px;border:none;background:transparent;color:var(--text);
      font-family:var(--fb);font-size:13px;font-weight:300;resize:none;outline:none;
      min-height:42px;max-height:110px;line-height:1.5;&::placeholder{color:var(--dim)}}
    .send-btn{width:42px;height:42px;border-radius:10px;border:none;
      background:linear-gradient(135deg,var(--red),var(--red-deep));color:#fff;cursor:pointer;font-size:16px;
      display:flex;align-items:center;justify-content:center;transition:.2s;flex-shrink:0;
      box-shadow:0 4px 12px var(--red-glow);
      &:hover:not(:disabled){transform:scale(1.05);box-shadow:0 6px 18px var(--red-glow)}
      &:disabled{opacity:.4;cursor:not-allowed}}
    .info-banner{padding:8px 12px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);
      border-radius:8px;font-size:12px;color:var(--blue);animation:fadeUp .3s ease}
  `]
})
export class ChatPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('bottom')      bottom!: ElementRef;
  @ViewChild('msgContainer') container!: ElementRef;

  S    = SECTORS;
  chips = [
    {k:'healthcare',label:'🏥 Healthcare'},{k:'financial',label:'🏦 Financial'},
    {k:'government',label:'🏛️ Government'},{k:'sme',label:'💼 SME'},
    {k:'manufacturing',label:'🏭 Manufacturing'},{k:'retail',label:'🛒 Retail'},
  ];

  inputText = '';
  banners: {id:number;text:string}[] = [];
  expanded = new Set<string>();
  private _bid = 0;
  private _scroll = false;
  private _d$ = new Subject<void>();

  sector = computed(() => this.st.sector());
  quickPrompts = computed(() => this.st.sector() ? SECTORS[this.st.sector()!].quickPrompts : []);

  tokenCount = computed(() => {
    const c = this.st.messages.reduce((a,m) => a + m.content.length, 0)
            + this.st.docs.reduce((a,d) => a + d.content.length, 0);
    return `~${Math.round(c/4).toLocaleString()} tokens`;
  });

  constructor(
    public st: StateService,
    public api: ApiService,
    public rag: RagService,
    public embedSvc: EmbeddingService,
    private au: AuditService,
    private san: DomSanitizer,
  ) {}

  ngOnInit() {
    this.st.messages$.pipe(takeUntil(this._d$)).subscribe(() => { this._scroll = true; });
  }
  ngAfterViewChecked() {
    if (this._scroll) { this.bottom?.nativeElement?.scrollIntoView({behavior:'smooth'}); this._scroll = false; }
  }
  ngOnDestroy() { this._d$.next(); this._d$.complete(); }

  get msgs(): ChatMessage[] { return this.st.messages; }

  pick(k: string) {
    this.st.sector.set(k);
    this.st.clearMessages();
    this.au.log('Sector Selected', SECTORS[k].name, 'public');
    this._welcome();
  }

  private _welcome() {
    const s = SECTORS[this.st.sector()!];
    const hasRag  = this.rag.hasIndex;
    const mode    = this.st.hybridMode();
    const modeStr = mode === 'hybrid' ? '🟢 **Hybrid RAG** active — Dense + Sparse + RRF'
                  : mode === 'local'  ? '🟡 **Local Mode** — upload docs & configure API to enable RAG'
                  : '🔄 Checking API…';
    const ragStr  = hasRag ? `\n\n🧠 **${this.rag.totalChunks} chunks indexed** — answers will cite source documents.` : '';
    this._addMsg({
      role: 'nora',
      content: `Hello! I'm **Nora**, your Singtel CSI advisor for **${s.name}**.\n\n`
             + `I cover: ${s.services.map(sv=>sv.tag).join(' · ')}\n\n${modeStr}${ragStr}\n\nWhat would you like to know?`
    });
  }

  async send() {
    const text = this.inputText.trim();
    if (!text || this.st.isLoading()) return;

    if (this.api.isInjection(text)) {
      this._banner('🛡️ Query blocked: prompt injection detected.');
      this.au.log('BLOCKED', text.slice(0,40), 'confidential');
      this.inputText = ''; return;
    }
    if (!this.st.canAccess(this.st.sensitivity())) {
      this._banner(`⚠️ Access denied: role (${this.st.role()}) cannot access ${this.st.sensitivity()} content.`);
      this.inputText = ''; return;
    }

    this.inputText = '';
    this._addMsg({ role: 'user', content: text });
    this.au.log('Query', text.slice(0,50) + (text.length>50?'…':''), this.st.sensitivity());
    this.st.isLoading.set(true);

    try {
      const { reply, mode, ragChunks } = await this.api.send(text, this.st.sector()||'sme', this.st.docs);
      const sources = ragChunks.length ? [...new Set(ragChunks.map(r=>r.chunk.docName))] : [];
      this._addMsg({ role:'nora', content: reply, docSources: sources, apiMode: mode, ragChunks });
      this.au.log(mode==='hybrid'?'Hybrid RAG Response':'Local Response',
                  `${SECTORS[this.st.sector()||'sme'].name} · ${ragChunks.length} chunks`,
                  this.st.sensitivity());
    } catch (err: any) {
      const fallback = this.api['_localAnswer']?.(text, this.st.sector()||'sme', this.st.docs) || 'Error: ' + err.message;
      this._addMsg({ role:'nora', content: `⚠️ API error — using local KB:\n\n${fallback}`, apiMode:'local', ragChunks:[] });
      this.api.health.set('offline'); this.st.hybridMode.set('local');
    } finally {
      this.st.isLoading.set(false);
    }
  }

  private _addMsg(partial: Partial<ChatMessage>) {
    const msg: ChatMessage = {
      id: 'msg-' + Date.now(), role: 'user', content: '',
      timestamp: new Date().toISOString(), ...partial
    };
    this.st.addMessage(msg);
  }

  quickSend(q: string) { this.inputText = q; this.send(); }
  onKey(e: KeyboardEvent) { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); this.send(); } }
  resize(el: HTMLTextAreaElement) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,110)+'px'; }
  toggleRag() { this.st.useRag.update(v=>!v); this.au.log('RAG Toggle', this.st.useRag()?'ON':'OFF','internal'); }
  recheck() { this.api.lastChecked=0; this.api.checkHealth().then(()=>this.st.hybridMode.set(this.api.hybridMode)); }
  toggle(id: string) { this.expanded.has(id)?this.expanded.delete(id):this.expanded.add(id); }

  copyTranscript() {
    const txt = this.st.messages.map(m => (m.role==='nora'?'[Nora]: ':'[User]: ')+m.content).join('\n\n');
    navigator.clipboard.writeText(txt).then(()=>this._banner('✓ Transcript copied!')).catch(()=>{});
  }

  private _banner(text: string) {
    const id = ++this._bid;
    this.banners.push({ id, text });
    setTimeout(()=>{ this.banners = this.banners.filter(b=>b.id!==id); }, 5000);
  }

  modeBarCls()  { return this.st.hybridMode(); }
  modeBarIcon() { const m=this.st.hybridMode(); return m==='hybrid'?'🟢':m==='local'?'🟡':'🔄'; }
  modeBarText() {
    const m = this.st.hybridMode();
    if (m==='hybrid') return '<strong>Hybrid RAG Mode</strong> — Dense (MiniLM) + Sparse (BM25) + RRF fusion';
    if (m==='local')  return '<strong>Local Mode</strong> — API unavailable, using built-in knowledge base';
    return 'Checking API availability…';
  }

  fmt(text: string): SafeHtml {
    const h = text
      .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
      .replace(/`(.*?)`/g,'<code>$1</code>')
      .replace(/^[•\-] (.+)/gm,'<li>$1</li>')
      .replace(/^(\d+)\. (.+)/gm,'<li><b>$1.</b> $2</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>')
      .replace(/\n/g,'<br>');
    return this.san.bypassSecurityTrustHtml(h);
  }
  fmtTime(ts: string) { try { return new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); } catch { return ''; } }
  trackId  = (_: number, m: ChatMessage) => m.id;
  trackBanner = (_: number, b: {id:number}) => b.id;
}
