import {
  Bot,
  BriefcaseBusiness,
  Loader2,
  MessageSquareText,
  Plus,
  Send,
  Target,
  UserRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createSession,
  getClientId,
  listMessages,
  listSessions,
  sendChatMessage
} from "./api";
import type { Message, Session } from "./types";

type SetupForm = {
  role: string;
  level: string;
  focus: string;
};

const defaultSetup: SetupForm = {
  role: "Frontend Engineer",
  level: "Mid-level",
  focus: "Behavioral and technical communication"
};

export function App() {
  const [clientId] = useState(getClientId);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [setup, setSetup] = useState(defaultSetup);
  const [draft, setDraft] = useState("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  useEffect(() => {
    void refreshSessions();
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, isSending]);

  async function refreshSessions(nextActiveId?: string) {
    setIsLoadingSessions(true);
    setError(null);

    try {
      const result = await listSessions(clientId);
      setSessions(result.sessions);

      const preferredId = nextActiveId ?? activeSessionId ?? result.sessions[0]?.id;
      if (preferredId) {
        setActiveSessionId(preferredId);
        await loadMessages(preferredId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load sessions.");
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function loadMessages(sessionId: string) {
    setIsLoadingMessages(true);
    setError(null);

    try {
      const result = await listMessages(sessionId);
      setMessages(result.messages);
      setActiveSessionId(sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load messages.");
    } finally {
      setIsLoadingMessages(false);
    }
  }

  async function handleCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      const result = await createSession({ clientId, ...setup });
      await refreshSessions(result.sessionId);
      setMessages([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create session.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();

    if (!content || !activeSessionId || isSending) {
      return;
    }

    const optimisticMessage: Message = {
      id: Date.now() * -1,
      sessionId: activeSessionId,
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };

    setDraft("");
    setMessages((current) => [...current, optimisticMessage]);
    setIsSending(true);
    setError(null);

    try {
      const result = await sendChatMessage({
        clientId,
        sessionId: activeSessionId,
        message: content
      });

      setMessages((current) => [
        ...current,
        {
          id: Date.now(),
          sessionId: activeSessionId,
          role: "assistant",
          content: result.reply,
          createdAt: new Date().toISOString()
        }
      ]);
      void refreshSessions(activeSessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send message.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="appShell">
      <aside className="sidebar" aria-label="Interview sessions">
        <div className="brand">
          <div className="brandMark">
            <Bot size={24} aria-hidden="true" />
          </div>
          <div>
            <p>Cloudflare AI</p>
            <h1>Interview Coach</h1>
          </div>
        </div>

        <form className="setupPanel" onSubmit={handleCreateSession}>
          <label>
            <span>
              <BriefcaseBusiness size={16} aria-hidden="true" />
              Role
            </span>
            <input
              value={setup.role}
              onChange={(event) =>
                setSetup((current) => ({ ...current, role: event.target.value }))
              }
              maxLength={120}
              required
            />
          </label>

          <label>
            <span>
              <UserRound size={16} aria-hidden="true" />
              Level
            </span>
            <select
              value={setup.level}
              onChange={(event) =>
                setSetup((current) => ({ ...current, level: event.target.value }))
              }
            >
              <option>Entry-level</option>
              <option>Mid-level</option>
              <option>Senior</option>
              <option>Staff</option>
              <option>Manager</option>
            </select>
          </label>

          <label>
            <span>
              <Target size={16} aria-hidden="true" />
              Focus
            </span>
            <input
              value={setup.focus}
              onChange={(event) =>
                setSetup((current) => ({ ...current, focus: event.target.value }))
              }
              maxLength={160}
              required
            />
          </label>

          <button className="primaryButton" type="submit" disabled={isCreating}>
            {isCreating ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
            New session
          </button>
        </form>

        <div className="sessionListHeader">
          <MessageSquareText size={17} aria-hidden="true" />
          <span>Saved sessions</span>
        </div>

        <div className="sessionList">
          {isLoadingSessions ? (
            <p className="muted">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="muted">No sessions yet.</p>
          ) : (
            sessions.map((session) => (
              <button
                className={`sessionButton ${session.id === activeSessionId ? "active" : ""}`}
                key={session.id}
                onClick={() => void loadMessages(session.id)}
                type="button"
              >
                <strong>{session.role}</strong>
                <span>
                  {session.level} · {session.focus}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="workspace" aria-label="Interview chat">
        <header className="chatHeader">
          <div>
            <p>{activeSession ? activeSession.focus : "Start a session"}</p>
            <h2>
              {activeSession
                ? `${activeSession.level} ${activeSession.role}`
                : "Choose a role and begin practicing"}
            </h2>
          </div>
          <div className="statusPill">
            {isSending ? "Thinking" : activeSession ? "Ready" : "Setup"}
          </div>
        </header>

        {error && <div className="errorBanner">{error}</div>}

        <div className="transcript" ref={transcriptRef}>
          {isLoadingMessages ? (
            <div className="emptyState">
              <Loader2 className="spin" size={24} />
              <p>Loading conversation...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="emptyState">
              <Bot size={34} />
              <h3>
                {activeSession
                  ? "Send your first answer or ask for a practice question."
                  : "Create a session to start your mock interview."}
              </h3>
              <p>
                The coach will keep memory for this browser and adapt feedback as
                the interview develops.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="messageAvatar">
                  {message.role === "assistant" ? (
                    <Bot size={18} aria-hidden="true" />
                  ) : (
                    <UserRound size={18} aria-hidden="true" />
                  )}
                </div>
                <p>{message.content}</p>
              </article>
            ))
          )}

          {isSending && (
            <article className="message assistant pending">
              <div className="messageAvatar">
                <Loader2 className="spin" size={18} aria-hidden="true" />
              </div>
              <p>Reviewing your answer...</p>
            </article>
          )}
        </div>

        <form className="composer" onSubmit={handleSend}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              activeSession
                ? "Type your answer or ask for the next question..."
                : "Create a session first..."
            }
            disabled={!activeSession || isSending}
            rows={3}
            maxLength={2000}
          />
          <button
            className="sendButton"
            type="submit"
            disabled={!activeSession || !draft.trim() || isSending}
            aria-label="Send message"
            title="Send message"
          >
            {isSending ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
          </button>
        </form>
      </section>
    </main>
  );
}

