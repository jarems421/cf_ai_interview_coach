import {
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Download,
  FileText,
  Loader2,
  Mic,
  MicOff,
  Moon,
  MessageSquareText,
  Plus,
  Send,
  Sun,
  Star,
  Trash2,
  WandSparkles,
  Target,
  TerminalSquare,
  UserRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createSession,
  deleteSession,
  getClientId,
  listMessages,
  listSessions,
  sendChatMessage
} from "./api";
import type { InterviewMode, Message, Session, SessionType } from "./types";

type SetupForm = {
  role: string;
  level: string;
  focus: string;
  cvText: string;
  jobDescription: string;
  companyName: string;
  sessionType: SessionType;
  interviewMode: InterviewMode;
};

const defaultSetup: SetupForm = {
  role: "Frontend Engineer",
  level: "Mid-level",
  focus: "Behavioral and technical communication",
  cvText: "",
  jobDescription: "",
  companyName: "",
  sessionType: "quick_practice",
  interviewMode: "behavioural"
};

const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  quick_practice: "Quick Practice",
  full_mock: "Full Mock Interview",
  project_defence: "Project Defence",
  technical_screen: "Technical Screen",
  company_specific: "Company-Specific"
};

const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  behavioural: "Behavioural",
  technical: "Technical",
  project_deep_dive: "Project Deep-dive",
  company_motivation: "Company Motivation",
  weakness_gap: "Weakness / Gap",
  final_simulation: "Final Simulation"
};

const themeStorageKey = "cf_ai_interview_coach_theme";

type SpeechRecognitionResult = {
  readonly [index: number]: { transcript: string; confidence: number };
  readonly length: number;
};

type SpeechRecognitionResultList = {
  readonly [index: number]: SpeechRecognitionResult;
  readonly length: number;
};

type SpeechRecognitionEvent = Event & {
  readonly results: SpeechRecognitionResultList;
};

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

const SpeechRecognitionAPI: SpeechRecognitionCtor | null =
  typeof window !== "undefined"
    ? ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition ??
      null)
    : null;

function getInitialTheme() {
  const requested = new URLSearchParams(window.location.search).get("theme");

  if (requested === "dark" || requested === "light") {
    return requested;
  }

  const stored = localStorage.getItem(themeStorageKey);

  if (stored === "dark" || stored === "light") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function App() {
  const [clientId] = useState(getClientId);
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [setup, setSetup] = useState(defaultSetup);
  const [draft, setDraft] = useState("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user"),
    [messages]
  );

  const hasTailoring = Boolean(
    activeSession?.cvText || activeSession?.jobDescription
  );

  useEffect(() => {
    void refreshSessions();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

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

  async function handleDeleteSession(sessionId: string) {
    if (!confirm("Delete this session and all its messages?")) {
      return;
    }

    setDeletingSessionId(sessionId);
    setError(null);

    try {
      await deleteSession(sessionId, clientId);

      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }

      setSessions((current) => current.filter((s) => s.id !== sessionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete session.");
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();

    await sendContent(content, "message");
  }

  async function sendContent(
    content: string,
    action:
      | "message"
      | "first_question"
      | "next_question"
      | "technical_question"
      | "tailored_question"
      | "rubric_score"
      | "scorecard"
      | "improve_answer"
      | "generate_report"
  ) {
    if ((!content && action === "message") || !activeSessionId || isSending) {
      return;
    }

    if (action === "scorecard" || action === "rubric_score" || action === "improve_answer" || action === "generate_report") {
      if (!lastUserMessage) {
        setError("Answer at least one interview question before using that action.");
        return;
      }
    }

    if (action === "message") {
      const optimisticMessage: Message = {
        id: Date.now() * -1,
        sessionId: activeSessionId,
        role: "user",
        content,
        createdAt: new Date().toISOString()
      };

      setDraft("");
      setMessages((current) => [...current, optimisticMessage]);
    }
    setIsSending(true);
    setError(null);

    try {
      const result = await sendChatMessage({
        clientId,
        sessionId: activeSessionId,
        message: content,
        action
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

  function exportTranscript() {
    if (!activeSession) {
      return;
    }

    const sessionTypeLabel = SESSION_TYPE_LABELS[activeSession.sessionType] ?? activeSession.sessionType;
    const modeLabel = INTERVIEW_MODE_LABELS[activeSession.interviewMode] ?? activeSession.interviewMode;

    const lines = [
      `# Interview Coach Session`,
      "",
      `Role: ${activeSession.role}`,
      `Level: ${activeSession.level}`,
      `Focus: ${activeSession.focus}`,
      `Session Type: ${sessionTypeLabel}`,
      `Interview Mode: ${modeLabel}`,
      ...(activeSession.companyName ? [`Company: ${activeSession.companyName}`] : []),
      `Date: ${new Date().toLocaleDateString()}`,
      "",
      "---",
      "",
      ...messages.flatMap((message) => [
        `## ${message.role === "assistant" ? "Coach" : "Candidate"}`,
        "",
        message.content,
        ""
      ])
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `interview-coach-${activeSession.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleVoiceInput() {
    if (!SpeechRecognitionAPI) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setDraft((current) => (current ? `${current} ${transcript}` : transcript));
      setIsListening(false);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  const hasAssistantQuestion = messages.some(
    (message) => message.role === "assistant"
  );

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

        <button
          className="themeToggle"
          type="button"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <Sun size={18} aria-hidden="true" />
          ) : (
            <Moon size={18} aria-hidden="true" />
          )}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>

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

          <label>
            <span>
              <TerminalSquare size={16} aria-hidden="true" />
              Session type
            </span>
            <select
              value={setup.sessionType}
              onChange={(event) =>
                setSetup((current) => ({
                  ...current,
                  sessionType: event.target.value as SessionType
                }))
              }
            >
              {(Object.entries(SESSION_TYPE_LABELS) as [SessionType, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                )
              )}
            </select>
          </label>

          <label>
            <span>
              <ClipboardCheck size={16} aria-hidden="true" />
              Interview mode
            </span>
            <select
              value={setup.interviewMode}
              onChange={(event) =>
                setSetup((current) => ({
                  ...current,
                  interviewMode: event.target.value as InterviewMode
                }))
              }
            >
              {(Object.entries(INTERVIEW_MODE_LABELS) as [InterviewMode, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                )
              )}
            </select>
          </label>

          <button
            className="advancedToggle"
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? (
              <ChevronUp size={15} aria-hidden="true" />
            ) : (
              <ChevronDown size={15} aria-hidden="true" />
            )}
            {showAdvanced ? "Hide" : "Add"} CV &amp; job description
          </button>

          {showAdvanced && (
            <>
              <label>
                <span>Company name (optional)</span>
                <input
                  value={setup.companyName}
                  onChange={(event) =>
                    setSetup((current) => ({
                      ...current,
                      companyName: event.target.value
                    }))
                  }
                  placeholder="e.g. Cloudflare"
                  maxLength={240}
                />
              </label>

              <label>
                <span>Your CV / resume (optional)</span>
                <textarea
                  className="setupTextarea"
                  value={setup.cvText}
                  onChange={(event) =>
                    setSetup((current) => ({
                      ...current,
                      cvText: event.target.value
                    }))
                  }
                  placeholder="Paste your CV or key experience here..."
                  maxLength={8000}
                  rows={5}
                />
              </label>

              <label>
                <span>Job description (optional)</span>
                <textarea
                  className="setupTextarea"
                  value={setup.jobDescription}
                  onChange={(event) =>
                    setSetup((current) => ({
                      ...current,
                      jobDescription: event.target.value
                    }))
                  }
                  placeholder="Paste the job description here..."
                  maxLength={4000}
                  rows={5}
                />
              </label>
            </>
          )}

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
            <p className="muted">No sessions yet. Create one above to start practicing.</p>
          ) : (
            sessions.map((session) => (
              <div
                className={`sessionItem ${session.id === activeSessionId ? "active" : ""}`}
                key={session.id}
              >
                <button
                  className="sessionButton"
                  onClick={() => void loadMessages(session.id)}
                  type="button"
                >
                  <strong>{session.role}</strong>
                  <span>
                    {SESSION_TYPE_LABELS[session.sessionType] ?? session.sessionType}
                  </span>
                  <span>
                    {session.level} · {INTERVIEW_MODE_LABELS[session.interviewMode] ?? session.interviewMode}
                  </span>
                  {session.companyName && (
                    <span className="sessionCompany">{session.companyName}</span>
                  )}
                </button>
                <button
                  className="sessionDeleteButton"
                  type="button"
                  onClick={() => void handleDeleteSession(session.id)}
                  disabled={deletingSessionId === session.id}
                  aria-label="Delete session"
                  title="Delete session"
                >
                  {deletingSessionId === session.id ? (
                    <Loader2 className="spin" size={14} aria-hidden="true" />
                  ) : (
                    <Trash2 size={14} aria-hidden="true" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="workspace" aria-label="Interview chat">
        <header className="chatHeader">
          <div>
            <p>
              {activeSession
                ? `${SESSION_TYPE_LABELS[activeSession.sessionType] ?? activeSession.sessionType} · ${INTERVIEW_MODE_LABELS[activeSession.interviewMode] ?? activeSession.interviewMode}${activeSession.companyName ? ` · ${activeSession.companyName}` : ""}`
                : "Start a session"}
            </p>
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
                {activeSession
                  ? hasTailoring
                    ? "CV and job description loaded — use \"Tailored question\" for personalised questions."
                    : "The coach will keep memory for this browser and adapt feedback as the interview develops."
                  : "Choose your role, session type, and optionally add your CV and job description for personalised questions."}
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

        <div className="quickActions" aria-label="Coaching actions">
          <button
            type="button"
            onClick={() =>
              void sendContent(
                "",
                hasAssistantQuestion ? "next_question" : "first_question"
              )
            }
            disabled={!activeSession || isSending}
          >
            <MessageSquareText size={17} aria-hidden="true" />
            {hasAssistantQuestion ? "Next question" : "First question"}
          </button>
          <button
            type="button"
            onClick={() => void sendContent("", "technical_question")}
            disabled={!activeSession || isSending}
          >
            <TerminalSquare size={17} aria-hidden="true" />
            Technical question
          </button>
          {hasTailoring && (
            <button
              type="button"
              onClick={() => void sendContent("", "tailored_question")}
              disabled={!activeSession || isSending}
            >
              <FileText size={17} aria-hidden="true" />
              Tailored question
            </button>
          )}
          <button
            type="button"
            onClick={() => void sendContent("", "rubric_score")}
            disabled={!activeSession || isSending || !lastUserMessage}
          >
            <Star size={17} aria-hidden="true" />
            Rubric score
          </button>
          <button
            type="button"
            onClick={() =>
              void sendContent("", "scorecard")
            }
            disabled={!activeSession || isSending || !lastUserMessage}
          >
            <ClipboardCheck size={17} aria-hidden="true" />
            Scorecard
          </button>
          <button
            type="button"
            onClick={() =>
              void sendContent(
                lastUserMessage?.content ?? "",
                "improve_answer"
              )
            }
            disabled={!activeSession || isSending || !lastUserMessage}
          >
            <WandSparkles size={17} aria-hidden="true" />
            Improve answer
          </button>
          <button
            type="button"
            onClick={() => void sendContent("", "generate_report")}
            disabled={!activeSession || isSending || !lastUserMessage}
          >
            <FileText size={17} aria-hidden="true" />
            Final report
          </button>
          <button
            type="button"
            onClick={exportTranscript}
            disabled={!activeSession || messages.length === 0}
          >
            <Download size={17} aria-hidden="true" />
            Export
          </button>
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
          <div className="composerActions">
            {SpeechRecognitionAPI && (
              <button
                className={`voiceButton ${isListening ? "listening" : ""}`}
                type="button"
                onClick={toggleVoiceInput}
                disabled={!activeSession || isSending}
                aria-label={isListening ? "Stop recording" : "Start voice input"}
                title={isListening ? "Stop recording" : "Start voice input"}
              >
                {isListening ? (
                  <MicOff size={18} aria-hidden="true" />
                ) : (
                  <Mic size={18} aria-hidden="true" />
                )}
              </button>
            )}
            <button
              className="sendButton"
              type="submit"
              disabled={!activeSession || !draft.trim() || isSending}
              aria-label="Send message"
              title="Send message"
            >
              {isSending ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
