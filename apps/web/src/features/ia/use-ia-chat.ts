import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IaConversation, IaConversationDetail, IaMessage, IaStreamEvent, IaToolCall } from '@app/shared';
import { api, apiEventStream } from '@/lib/api-client';

/** A resposta que está chegando: texto parcial e as consultas até agora. */
export interface IaLive {
  messageId: string | null;
  text: string;
  tools: IaToolCall[];
  error: string | null;
}

const EMPTY_LIVE: IaLive = { messageId: null, text: '', tools: [], error: null };

/**
 * A conversa com a ia.Transppass no front: lista de conversas e mensagens
 * pelo react-query; o envio abre o stream, acumula o texto e as consultas em
 * `live` e, no fim, grava a mensagem definitiva no cache sem refazer a busca.
 */
export function useIaChat(conversationId: string | null, onConversationCreated: (id: string) => void) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState<IaLive>(EMPTY_LIVE);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [optimistic, setOptimistic] = useState<IaMessage | null>(null);

  const conversations = useQuery({
    queryKey: ['ia', 'conversations'],
    queryFn: () => api.get<IaConversation[]>('/ia/conversations'),
  });
  const detail = useQuery({
    queryKey: ['ia', 'conversation', conversationId],
    queryFn: () => api.get<IaConversationDetail>(`/ia/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
    retry: false,
  });

  // Conversa apagada ou de outra conta: volta para "nova".
  useEffect(() => {
    if (detail.isError && conversationId) onConversationCreated('');
  }, [detail.isError, conversationId, onConversationCreated]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string, context: { route: string; label: string }) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setLive(EMPTY_LIVE);
      setOptimistic({ id: `tmp-${Date.now()}`, role: 'user', text: trimmed, toolCalls: [], usage: null, error: null, createdAt: new Date().toISOString() });
      let id = conversationId;
      try {
        if (!id) {
          const created = await api.post<IaConversation>('/ia/conversations', {});
          id = created.id;
          onConversationCreated(id);
          queryClient.setQueryData<IaConversation[]>(['ia', 'conversations'], (old) => [created, ...(old ?? [])]);
        }
        const abort = new AbortController();
        abortRef.current = abort;
        let final: IaMessage | null = null;
        let title: string | null = null;
        await apiEventStream<IaStreamEvent>(`/ia/conversations/${id}/messages`, { text: trimmed, context }, {
          signal: abort.signal,
          onEvent: (ev) => {
            if (ev.type === 'start') setLive((l) => ({ ...l, messageId: ev.messageId }));
            else if (ev.type === 'text') setLive((l) => ({ ...l, text: l.text + ev.delta }));
            else if (ev.type === 'tool') {
              setLive((l) => {
                const rest = l.tools.filter((t) => t.id !== ev.call.id);
                // Em andamento: ms negativo, até o fim da consulta trazer o tempo real.
                return { ...l, tools: [...rest, ev.phase === 'start' ? { ...ev.call, ms: -1 } : ev.call] };
              });
            } else if (ev.type === 'done') {
              final = ev.message;
              title = ev.title;
            } else if (ev.type === 'error') setLive((l) => ({ ...l, error: ev.message }));
          },
        });
        // O servidor é a fonte: recarrega a conversa (pergunta e resposta gravadas) e a lista.
        // `sending` só cai depois, para o texto ao vivo não sumir antes de a versão gravada entrar.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['ia', 'conversation', id] }),
          queryClient.invalidateQueries({ queryKey: ['ia', 'conversations'] }),
        ]);
        void final;
        void title;
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setLive((l) => ({ ...l, error: err instanceof Error ? err.message : String(err) }));
        }
        // A pergunta ficou gravada no servidor mesmo com erro: recarrega a conversa.
        if (id) void queryClient.invalidateQueries({ queryKey: ['ia', 'conversation', id] });
      } finally {
        abortRef.current = null;
        setSending(false);
        setOptimistic(null);
        setLive(EMPTY_LIVE);
      }
    },
    [conversationId, onConversationCreated, queryClient, sending],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.delete(`/ia/conversations/${id}`);
      queryClient.setQueryData<IaConversation[]>(['ia', 'conversations'], (old) => (old ?? []).filter((c) => c.id !== id));
      queryClient.removeQueries({ queryKey: ['ia', 'conversation', id] });
    },
    [queryClient],
  );

  return { conversations, detail, live, sending, optimistic, send, stop, remove };
}
