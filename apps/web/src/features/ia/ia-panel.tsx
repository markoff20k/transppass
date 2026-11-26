import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowRight, ArrowUp, Check, ChevronDown, Copy, Eye, History, Loader2, Plus, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import type { IaMessage, IaToolCall } from '@app/shared';
import { useI18n } from '@/i18n/i18n.context';
import { useAuth } from '@/features/auth/use-auth';
import { formatDateTime } from '@/lib/format';
import { useIa } from './ia.context';
import { useIaChat } from './use-ia-chat';
import { screenOf } from './ia-suggestions';
import { IaBot, IaScene } from './ia-mark';

/**
 * O painel da ia.Transppass: encosta à direita, abaixo do cabeçalho, e a
 * tela continua utilizável ao lado. Conversas por usuário (a atual fica na
 * conta), resposta em streaming com as consultas que o agente fez, atalhos
 * de pergunta conforme a tela aberta. Enter envia, Shift+Enter quebra linha.
 */
export function IaPanel() {
  const { t } = useI18n();
  const { user } = useAuth();
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
  // Conversa nova: a busca da conversa já traz a pergunta gravada enquanto a resposta chega; aí a otimista sai.
  const last = messages[messages.length - 1];
  const optimistic = chat.optimistic && !(last?.role === 'user' && last.text === chat.optimistic.text) ? chat.optimistic : null;
  const empty = messages.length === 0 && !optimistic;
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';

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
  const newChat = () => {
    setConversationId(null);
    setHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  if (!open) return null;

  const statusLabel = !status ? '' : status.provider === 'anthropic' ? t.ia.online : status.provider === 'fake' ? t.ia.simulated : t.ia.off;
  const conversations = chat.conversations.data ?? [];

  return (
    <aside className="ia-panel" role="complementary" aria-label={t.ia.title}>
      <header className="ia-panel__head">
        <IaBot size={40} live={chat.sending} />
        <div className="ia-panel__title">
          <b className="ia-name"><span>ia.</span>Transppass</b>
          <span className="ia-panel__sub">
            {t.ia.role}
            <span className={`ia-panel__status${enabled ? ' is-on' : ''}${status?.provider === 'fake' ? ' is-test' : ''}`}>{statusLabel}</span>
          </span>
        </div>
        <div className="ia-panel__tools">
          <button type="button" className="ia-panel__tool" title={t.ia.newChat} aria-label={t.ia.newChat} onClick={newChat}>
            <Plus size={17} aria-hidden />
          </button>
          <button type="button" className={`ia-panel__tool${historyOpen ? ' is-active' : ''}`} title={t.ia.history} aria-label={t.ia.history} aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
            <History size={16} aria-hidden />
          </button>
          <button type="button" className="ia-panel__tool" title={t.ia.close} aria-label={t.ia.close} onClick={() => setOpen(false)}>
            <X size={17} aria-hidden />
          </button>
        </div>
      </header>

      <div className="ia-panel__main">
        {historyOpen && (
          <div className="ia-history">
            <div className="ia-history__head">
              <span>{t.ia.history}</span>
              <button type="button" className="ia-history__new" onClick={newChat}>
                <Plus size={14} aria-hidden /> {t.ia.newChat}
              </button>
            </div>
            {conversations.length === 0 && <p className="ia-history__empty">{t.ia.noHistory}</p>}
            <ul>
              {conversations.map((c) => (
                <li key={c.id} className={c.id === conversationId ? 'is-active' : ''}>
                  <button type="button" className="ia-history__item" onClick={() => { setConversationId(c.id); setHistoryOpen(false); }}>
                    <span className="ia-history__title">{c.title}</span>
                    <span className="ia-history__meta">{formatDateTime(c.updatedAt)} · {c.messageCount} {t.ia.messages}</span>
                  </button>
                  <button type="button" className="ia-history__del" title={t.ia.delete} aria-label={t.ia.delete} onClick={() => { void chat.remove(c.id); if (c.id === conversationId) setConversationId(null); }}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div ref={bodyRef} className={`ia-panel__body${empty ? ' is-empty' : ''}`}>
          {!enabled && <div className="ia-notice">{t.ia.offHelp}</div>}
          {enabled && status?.provider === 'fake' && <div className="ia-notice">{t.ia.simulatedHelp}</div>}

          {empty ? (
            <section className="ia-welcome">
              <IaScene />
              <h2 className="ia-welcome__hello">
                {firstName ? <>{t.ia.hello} <em>{firstName}</em>.</> : t.ia.helloAnon}
              </h2>
              <p className="ia-welcome__lead">{t.ia.welcome}</p>
              {enabled && (
                <div className="ia-welcome__suggest" aria-label={t.ia.suggestions}>
                  <span className="ia-welcome__label">{t.ia.suggestionsFor.replace('{s}', screen.label)}</span>
                  {screen.suggestions.map((s) => (
                    <button key={s} type="button" className="ia-suggest" onClick={() => submit(s)}>
                      <span>{s}</span>
                      <ArrowRight size={15} aria-hidden />
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="ia-thread">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
              {optimistic && <Message message={optimistic} />}
              {chat.sending && (
                <article className="ia-msg ia-msg--assistant is-live" aria-live="polite">
                  <AssistantHead live />
                  <Steps tools={chat.live.tools} live />
                  {chat.live.text ? (
                    <div className="ia-msg__text">
                      {renderText(chat.live.text)}
                      <span className="ia-msg__caret" aria-hidden />
                    </div>
                  ) : (
                    <div className="ia-msg__thinking">{t.ia.thinking}</div>
                  )}
                  {chat.live.error && <p className="ia-msg__error">{chat.live.error}</p>}
                </article>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="ia-panel__foot">
        <form className={`ia-composer${!enabled ? ' is-disabled' : ''}`} onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            className="ia-composer__input"
            rows={1}
            placeholder={enabled ? t.ia.placeholder : t.ia.off}
            value={draft}
            disabled={!enabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            aria-label={t.ia.placeholder}
          />
          <div className="ia-composer__bar">
            <span className="ia-composer__ctx" title={t.ia.screenHint.replace('{s}', screen.label)}>
              <Eye size={13} aria-hidden /> {screen.label}
            </span>
            {chat.sending ? (
              <button type="button" className="ia-composer__send is-stop" onClick={chat.stop} title={t.ia.stop} aria-label={t.ia.stop}>
                <Square size={12} fill="currentColor" aria-hidden />
              </button>
            ) : (
              <button type="submit" className="ia-composer__send" disabled={!enabled || !draft.trim()} title={t.ia.send} aria-label={t.ia.send}>
                <ArrowUp size={17} aria-hidden />
              </button>
            )}
          </div>
        </form>
        <span className="ia-panel__note">
          <ShieldCheck size={12} aria-hidden /> {t.ia.note}
        </span>
      </footer>
    </aside>
  );
}

function AssistantHead({ live = false, at }: { live?: boolean; at?: string }) {
  return (
    <div className="ia-msg__head">
      <IaBot size={26} live={live} />
      <b className="ia-name"><span>ia.</span>Transppass</b>
      {at && <time>{formatDateTime(at)}</time>}
    </div>
  );
}

function Message({ message }: { message: IaMessage }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (message.role === 'user') {
    return (
      <article className="ia-msg ia-msg--user">
        <div className="ia-msg__text">{renderText(message.text)}</div>
      </article>
    );
  }
  const copy = () => {
    void navigator.clipboard
      ?.writeText(message.text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  };
  return (
    <article className="ia-msg ia-msg--assistant">
      <AssistantHead at={message.createdAt} />
      <Steps tools={message.toolCalls} />
      <div className="ia-msg__text">{renderText(message.text)}</div>
      {message.error && <p className="ia-msg__error">{message.error}</p>}
      {message.text && (
        <div className="ia-msg__actions">
          <button type="button" className={`ia-msg__action${copied ? ' is-done' : ''}`} onClick={copy}>
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? t.ia.copied : t.ia.copy}
          </button>
        </div>
      )}
    </article>
  );
}

/** As consultas que a ia.Transppass fez: abertas enquanto ela lê, recolhidas depois. */
function Steps({ tools, live = false }: { tools: IaToolCall[]; live?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;
  const expanded = live || open;
  const total = tools.reduce((s, c) => s + Math.max(c.ms, 0), 0);
  const summary = (tools.length === 1 ? t.ia.consultedOne : t.ia.consultedMany.replace('{n}', String(tools.length))) + (live ? '' : ` · ${duration(total)}`);
  return (
    <div className={`ia-steps${expanded ? ' is-open' : ''}`}>
      {!live && (
        <button type="button" className="ia-steps__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="ia-steps__dot" aria-hidden />
          {summary}
          <ChevronDown size={14} aria-hidden />
        </button>
      )}
      {expanded && (
        <ol className="ia-steps__list" aria-label={t.ia.consulted}>
          {tools.map((c) => (
            <li key={c.id} className={c.ms < 0 ? 'is-running' : c.ok ? 'is-done' : 'is-error'}>
              <span className="ia-steps__icon">{c.ms < 0 ? <Loader2 size={12} className="spin" aria-hidden /> : c.ok ? <Check size={11} aria-hidden /> : <X size={11} aria-hidden />}</span>
              <span className="ia-steps__label">{c.label}</span>
              {c.ms >= 0 && <em>{duration(c.ms)}</em>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const duration = (ms: number) => (ms < 1000 ? `${Math.max(ms, 1)} ms` : `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`);

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
