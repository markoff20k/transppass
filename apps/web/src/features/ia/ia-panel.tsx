import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, Check, History, Loader2, Plus, Send, Square, Trash2, X } from 'lucide-react';
import type { IaMessage, IaToolCall } from '@app/shared';
import { useI18n } from '@/i18n/i18n.context';
import { formatDateTime } from '@/lib/format';
import { useIa } from './ia.context';
import { useIaChat } from './use-ia-chat';
import { screenOf } from './ia-suggestions';

/**
 * O painel da ia.Transppass: encosta à direita, abaixo do cabeçalho, e a
 * tela continua utilizável ao lado. Conversas por usuário (a atual fica na
 * conta), resposta em streaming com as consultas que o agente fez, atalhos
 * de pergunta conforme a tela aberta. Enter envia, Shift+Enter quebra linha.
 */
export function IaPanel() {
  const { t } = useI18n();
  const { status, open, setOpen, conversationId, setConversationId } = useIa();
  const location = useLocation();
  const screen = useMemo(() => screenOf(location.pathname), [location.pathname]);
  const onCreated = useCallback((id: string) => setConversationId(id || null), [setConversationId]);
  const chat = useIaChat(conversationId, onCreated);
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages: IaMessage[] = chat.detail.data?.messages ?? [];
  const enabled = status?.enabled ?? false;

  // Acompanha a resposta: rola para o fim conforme o texto chega.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, chat.live.text, chat.live.tools.length, chat.optimistic, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, conversationId]);

  const submit = (text: string) => {
    if (!text.trim() || chat.sending || !enabled) return;
    setDraft('');
    void chat.send(text, { route: location.pathname, label: screen.label });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(draft);
    }
  };

  if (!open) return null;

  const providerLabel = !status ? '' : status.provider === 'anthropic' ? modelName(status.model) : status.provider === 'fake' ? t.ia.simulated : t.ia.off;

  return (
    <aside className="ia-panel" role="complementary" aria-label={t.ia.title}>
      <header className="ia-panel__head">
        <span className="ia-panel__logo" aria-hidden>
          <Bot size={18} />
        </span>
        <div className="ia-panel__title">
          <b>{t.ia.title}</b>
          <span className={`ia-panel__status${enabled ? ' is-on' : ''}`}>{providerLabel}</span>
        </div>
        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm ia-panel__tool" title={t.ia.newChat} aria-label={t.ia.newChat} onClick={() => { setConversationId(null); setHistoryOpen(false); }}>
          <Plus size={16} aria-hidden />
        </button>
        <button type="button" className={`tp-btn tp-btn--ghost tp-btn--sm ia-panel__tool${historyOpen ? ' is-active' : ''}`} title={t.ia.history} aria-label={t.ia.history} aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
          <History size={16} aria-hidden />
        </button>
        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm ia-panel__tool" title={t.ia.close} aria-label={t.ia.close} onClick={() => setOpen(false)}>
          <X size={16} aria-hidden />
        </button>
      </header>

      {historyOpen && (
        <div className="ia-panel__history">
          {(chat.conversations.data ?? []).length === 0 && <p className="tp-muted">{t.ia.noHistory}</p>}
          <ul>
            {(chat.conversations.data ?? []).map((c) => (
              <li key={c.id} className={c.id === conversationId ? 'is-active' : ''}>
                <button type="button" className="ia-panel__hist-item" onClick={() => { setConversationId(c.id); setHistoryOpen(false); }}>
                  <span className="ia-panel__hist-title">{c.title}</span>
                  <span className="ia-panel__hist-meta">{formatDateTime(c.updatedAt)} · {c.messageCount} {t.ia.messages}</span>
                </button>
                <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm ia-panel__hist-del" title={t.ia.delete} aria-label={t.ia.delete} onClick={() => { void chat.remove(c.id); if (c.id === conversationId) setConversationId(null); }}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={bodyRef} className="ia-panel__body">
        {!enabled && (
          <div className="tp-alert tp-alert--warning ia-panel__alert" role="status">
            {t.ia.offHelp}
          </div>
        )}
        {enabled && status?.provider === 'fake' && (
          <div className="tp-alert tp-alert--warning ia-panel__alert" role="status">
            {t.ia.simulatedHelp}
          </div>
        )}
        {messages.length === 0 && !chat.optimistic && (
          <div className="ia-panel__welcome">
            <p>{t.ia.welcome}</p>
            <p className="tp-muted">{t.ia.screenHint.replace('{s}', screen.label)}</p>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {chat.optimistic && <Message message={chat.optimistic} />}
        {chat.sending && (
          <article className="ia-msg ia-msg--assistant is-live" aria-live="polite">
            <ToolChips tools={chat.live.tools} />
            {chat.live.text ? <div className="ia-msg__text">{renderText(chat.live.text)}<span className="ia-msg__caret" aria-hidden /></div> : <div className="ia-msg__thinking"><Loader2 size={14} className="spin" aria-hidden /> {t.ia.thinking}</div>}
            {chat.live.error && <p className="ia-msg__error">{chat.live.error}</p>}
          </article>
        )}
      </div>

      <footer className="ia-panel__foot">
        {messages.length === 0 && !chat.sending && enabled && (
          <div className="ia-panel__suggestions" aria-label={t.ia.suggestions}>
            {screen.suggestions.map((s) => (
              <button key={s} type="button" className="ia-panel__chip" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <form className="ia-panel__form" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            className="tp-textarea ia-panel__input"
            rows={1}
            placeholder={enabled ? t.ia.placeholder : t.ia.off}
            value={draft}
            disabled={!enabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            aria-label={t.ia.placeholder}
          />
          {chat.sending ? (
            <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm ia-panel__send" onClick={chat.stop} title={t.ia.stop} aria-label={t.ia.stop}>
              <Square size={14} aria-hidden />
            </button>
          ) : (
            <button type="submit" className="tp-btn tp-btn--primary tp-btn--sm ia-panel__send" disabled={!enabled || !draft.trim()} title={t.ia.send} aria-label={t.ia.send}>
              <Send size={14} aria-hidden />
            </button>
          )}
        </form>
        <span className="ia-panel__note tp-muted">{t.ia.note.replace('{s}', screen.label)}</span>
      </footer>
    </aside>
  );
}

function Message({ message }: { message: IaMessage }) {
  const { t } = useI18n();
  if (message.role === 'user') {
    return (
      <article className="ia-msg ia-msg--user">
        <div className="ia-msg__text">{renderText(message.text)}</div>
      </article>
    );
  }
  return (
    <article className="ia-msg ia-msg--assistant">
      <ToolChips tools={message.toolCalls} />
      <div className="ia-msg__text">{renderText(message.text)}</div>
      {message.error && <p className="ia-msg__error">{message.error}</p>}
      {message.usage && message.usage.input + message.usage.output > 0 && (
        <span className="ia-msg__meta tp-muted" title={t.ia.usageHint}>
          {formatDateTime(message.createdAt)} · {(message.usage.input + message.usage.cacheRead + message.usage.output).toLocaleString('pt-BR')} tokens
        </span>
      )}
    </article>
  );
}

function ToolChips({ tools }: { tools: IaToolCall[] }) {
  const { t } = useI18n();
  if (tools.length === 0) return null;
  return (
    <ul className="ia-msg__tools" aria-label={t.ia.consulted}>
      {tools.map((c) => (
        <li key={c.id} className={`ia-msg__tool${c.ms < 0 ? ' is-running' : c.ok ? '' : ' is-error'}`} title={`${c.name} · ${JSON.stringify(c.input)}`}>
          {c.ms < 0 ? <Loader2 size={11} className="spin" aria-hidden /> : <Check size={11} aria-hidden />}
          <span>{c.label}</span>
          {c.ms >= 0 && <em>{c.ms < 1000 ? `${Math.max(c.ms, 1)} ms` : `${(c.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`}</em>}
        </li>
      ))}
    </ul>
  );
}

const nameMap: Record<string, string> = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5', 'claude-fable-5-1': 'Claude Fable 5.1' };
const modelName = (id: string) => nameMap[id] ?? id;

/**
 * Texto do agente para a tela: parágrafos, listas com "-" e **negrito**.
 * Sem biblioteca de markdown: é tudo o que o prompt de sistema permite.
 */
export function renderText(text: string): ReactNode {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(<p key={`p${out.length}`}>{inline(para.join(' '))}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(<ul key={`l${out.length}`}>{list}</ul>);
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const item = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      list.push(<li key={`i${list.length}`}>{inline(item[1] as string)}</li>);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out;
}

function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
}
