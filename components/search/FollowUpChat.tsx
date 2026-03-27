"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useMarkdownComponents } from "./markdown";

export interface FollowUpMessage {
  role: "user" | "assistant";
  content: string;
  cost_usd?: number;
  error?: boolean;
}

const SUGGESTIONS = [
  "Które orzeczenia są najbardziej istotne?",
  "Czy istnieją sprzeczne stanowiska?",
  "Podsumuj kluczowe tezy prawne",
];

function WaitingIndicator() {
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-muted">
      Analizuję {elapsed > 0 ? `${elapsed}` : ""}
      <span className="inline-flex w-6 overflow-hidden align-baseline">
        <span className="animate-ellipsis">...</span>
      </span>
    </span>
  );
}

function ExchangeCard({
  exchange,
  isStreaming,
  streamContent,
  streamEndRef,
  components,
  onRetry,
}: {
  exchange: { question: FollowUpMessage; answer?: FollowUpMessage };
  isStreaming: boolean;
  streamContent: string;
  streamEndRef?: React.RefObject<HTMLDivElement | null>;
  components: ReturnType<typeof useMarkdownComponents>;
  onRetry?: (message: string) => void;
}) {
  const answerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!answerRef.current) return;
    try {
      const html = answerRef.current.innerHTML;
      const plain = answerRef.current.innerText;
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } catch {
      if (answerRef.current) {
        await navigator.clipboard.writeText(answerRef.current.innerText);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasFinishedAnswer = exchange.answer && !exchange.answer.error;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Question */}
      <div className="px-4 pt-3 pb-2 border-b border-border/50 bg-background/50">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-muted uppercase tracking-wide">
            Pytanie
          </span>
          <div className="flex items-center gap-2">
            {exchange.answer?.cost_usd != null && exchange.answer.cost_usd > 0 && (
              <span className="text-[11px] text-muted font-mono">
                {exchange.answer.cost_usd < 0.01 ? "<0,01" : exchange.answer.cost_usd.toFixed(4).replace(".", ",")} USD
              </span>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-foreground leading-relaxed">
          {exchange.question.content}
        </p>
      </div>

      {/* Answer */}
      <div className="px-4 pt-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-accent uppercase tracking-wide">
            Odpowiedź
          </span>
          {hasFinishedAnswer && !isStreaming && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors cursor-pointer"
            >
              {copied ? "Skopiowano!" : "Kopiuj"}
            </button>
          )}
        </div>
        <div className="ai-overview text-sm leading-relaxed" ref={answerRef}>
          {exchange.answer ? (
            exchange.answer.error ? (
              <div className="text-sm text-error/80">
                Nie udało się wygenerować odpowiedzi.
                {onRetry && (
                  <button
                    onClick={() => onRetry(exchange.question.content)}
                    className="text-accent hover:underline ml-1"
                  >
                    Spróbuj ponownie
                  </button>
                )}
              </div>
            ) : (
              <ReactMarkdown components={components}>{exchange.answer.content}</ReactMarkdown>
            )
          ) : isStreaming ? (
            streamContent ? (
              <>
                <ReactMarkdown components={components}>{streamContent}</ReactMarkdown>
                <span className="inline-block w-1.5 h-4 bg-accent/60 animate-pulse ml-0.5 align-text-bottom" />
              </>
            ) : (
              <WaitingIndicator />
            )
          ) : (
            <WaitingIndicator />
          )}
        </div>
        {isStreaming && streamEndRef && <div ref={streamEndRef} />}
      </div>
    </div>
  );
}

export function FollowUpChat({
  messages,
  streaming,
  streamContent,
  onSend,
  sygnaturaMap,
  disabled,
  onRetry,
}: {
  messages: FollowUpMessage[];
  streaming: boolean;
  streamContent: string;
  onSend: (message: string) => void;
  sygnaturaMap: Record<string, number>;
  disabled: boolean;
  onRetry?: (message: string) => void;
}) {
  const components = useMarkdownComponents(sygnaturaMap);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  const hasConversation = messages.length > 0;
  const isInputDisabled = disabled || streaming;
  const canSend = !isInputDisabled && input.trim().length > 0;

  // Auto-expand textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, []);

  // Auto-scroll to streaming content
  useEffect(() => {
    if (streaming && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [streaming, streamContent]);

  const handleSend = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isInputDisabled) return;
    onSend(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [onSend, isInputDisabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  // Group messages into Q&A exchanges
  const exchanges: { question: FollowUpMessage; answer?: FollowUpMessage }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      const next = messages[i + 1];
      exchanges.push({
        question: msg,
        answer: next?.role === "assistant" ? next : undefined,
      });
      if (next?.role === "assistant") i++;
    }
  }

  // If streaming, the last exchange might not have an answer yet
  const isLastExchangeStreaming = streaming && exchanges.length > 0 && !exchanges[exchanges.length - 1].answer;

  return (
    <div className="space-y-3">
      {/* Conversation exchanges */}
      {exchanges.map((exchange, i) => (
        <ExchangeCard
          key={i}
          exchange={exchange}
          isStreaming={isLastExchangeStreaming && i === exchanges.length - 1}
          streamContent={streamContent}
          streamEndRef={isLastExchangeStreaming && i === exchanges.length - 1 ? streamEndRef : undefined}
          components={components}
          onRetry={onRetry}
        />
      ))}

      {/* Suggested follow-ups (only before first question, when not disabled) */}
      {!hasConversation && !disabled && !streaming && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((text) => (
            <button
              key={text}
              onClick={() => handleSend(text)}
              className="rounded-md border border-accent/20 bg-accent/5 px-3 py-1.5 text-xs text-accent hover:bg-accent/10 hover:border-accent/40 transition-colors cursor-pointer"
            >
              {text}
            </button>
          ))}
        </div>
      )}

      {/* Conversation limit message */}
      {messages.length >= 40 && (
        <div className="rounded-lg border border-border/60 bg-background px-4 py-3 text-center">
          <p className="text-xs text-muted">
            Osiągnięto limit 20 pytań. Rozpocznij nowe wyszukiwanie, aby kontynuować.
          </p>
        </div>
      )}

      {/* Input area */}
      {messages.length < 40 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                adjustHeight();
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                disabled
                  ? "Poczekaj na zakończenie analizy..."
                  : "Zadaj dodatkowe pytanie o analizie..."
              }
              disabled={isInputDisabled}
              className="flex-1 resize-none text-sm bg-transparent border-none focus:outline-none placeholder:text-muted/50 leading-relaxed max-h-32 overflow-y-auto disabled:opacity-50"
            />
            {/* Desktop send button */}
            <button
              onClick={() => handleSend(input)}
              disabled={!canSend}
              className="hidden sm:block shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Wyślij
            </button>
            {/* Mobile send button (icon) */}
            <button
              onClick={() => handleSend(input)}
              disabled={!canSend}
              className="sm:hidden shrink-0 rounded-md bg-primary p-2 text-white hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
