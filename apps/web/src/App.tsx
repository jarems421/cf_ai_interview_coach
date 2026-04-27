import {
  Bot,
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  Download,
  FileText,
  Loader2,
  Moon,
  MessageSquareText,
  Plus,
  Send,
  Sun,
  WandSparkles,
  Target,
  TerminalSquare,
  UserRound,
  Zap
} from "lucide-react";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import {
  createSession,
  getClientId,
  listMessages,
  listSessions,
  sendChatMessage
} from "./api";
import type { InterviewMode, Message, Session } from "./types";

type SetupForm = {
  role: string;
  level: string;
  focus: string;
  companyName: string;
  interviewMode: InterviewMode;
  cvText: string;
  jobDescription: string;
};

const defaultSetup: SetupForm = {
  role: "Frontend Engineer",
  level: "Mid-level",
  focus: "Behavioral and technical communication",
  companyName: "",
  interviewMode: "behavioural",
  cvText: "",
  jobDescription: ""
};

const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  behavioural: "Behavioural",
  technical: "Technical",
  project_deep_dive: "Project deep-dive",
  company_motivation: "Company motivation",
  weakness_gap: "Weakness / gap",
  final_simulation: "Final simulation"
};

type Preset = {
  label: string;
  role: string;
  level: string;
  focus: string;
  interviewMode: InterviewMode;
};

const PRESETS: Preset[] = [
  {
    label: "Behavioural",
    role: "Software Engineer",
    level: "Mid-level",
    focus: "Leadership, teamwork, and conflict resolution",
    interviewMode: "behavioural"
  },
  {
    label: "System Design",
    role: "Senior Software Engineer",
    level: "Senior",
    focus: "System design: scalability, reliability, and trade-offs",
    interviewMode: "technical"
  },
  {
    label: "Frontend Coding",
    role: "Frontend Engineer",
    level: "Mid-level",
    focus: "JavaScript, React, CSS, and browser APIs",
    interviewMode: "technical"
  }
];

const themeStorageKey = "cf_ai_interview_coach_theme";

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

// Lazily import TurnstileWidget only when a site key is configured
const TurnstileWidget = turnstileSiteKey
  ? lazy(() =>
      import("./TurnstileWidget").then((m) => ({ default: m.TurnstileWidget }))
    )
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

// ── Clerk (optional) ─────────────────────────────────────────────────────────

type AuthState = {
  isSignedIn: boolean | undefined;
  userId: string | null | undefined;
  getToken: () => Promise<string | null>;
};

function useAuthState(): AuthState {
  // Inline hook: reads from Clerk if available, otherwise returns anonymous state
  if (clerkEnabled) {
    try {
      // We import Clerk conditionally at module level (see ClerkGate)
      // Here we call through a stable hook reference stored on the window
      const hook = (window as unknown as Record<string, unknown>)
        .__clerkUseAuth as (() => AuthState) | undefined;
      if (hook) {
        return hook();
      }
    } catch {
      // Clerk not ready yet
    }
  }
  return {
    isSignedIn: undefined,
    userId: null,
    getToken: () => Promise.resolve(null)
  };
}

export function App() {
  const { isSignedIn, getToken, userId } = useAuthState();

  // Determine client ID: use Clerk user ID when authenticated, otherwise localStorage
  const localClientId = useMemo(() => getClientId(), []);
  const clientId =
    clerkEnabled && userId ? userId : localClientId;

  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [setup, setSetup] = useState(defaultSetup);
  const [showCvFields, setShowCvFields] = useState(false);
  const [draft, setDraft] = useState("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user"),
    [messages]
  );

  // Refresh sessions whenever auth state or clientId changes
  useEffect(() => {
    if (clerkEnabled && isSignedIn === undefined) {
      return; // Wait for Clerk to initialise
    }
    if (clerkEnabled && !isSignedIn) {
      setIsLoadingSessions(false);
      return; // Don't fetch when not signed in
    }
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, isSignedIn]);

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

  async function getAuthToken() {
    if (!clerkEnabled || !isSignedIn) return undefined;
    try {
      return (await getToken()) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async function refreshSessions(nextActiveId?: string) {
    setIsLoadingSessions(true);
    setError(null);

    try {
      const authToken = await getAuthToken();
      const result = await listSessions(clientId, authToken);
      setSessions(result.sessions);

      const preferredId =
        nextActiveId ?? activeSessionId ?? result.sessions[0]?.id;
      if (preferredId) {
        setActiveSessionId(preferredId);
        await loadMessages(preferredId);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load sessions."
      );
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function loadMessages(sessionId: string) {
    setIsLoadingMessages(true);
    setError(null);

    try {
      const authToken = await getAuthToken();
      const result = await listMessages(sessionId, authToken);
      setMessages(result.messages);
      setActiveSessionId(sessionId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load messages."
      );
    } finally {
      setIsLoadingMessages(false);
    }
  }

  function applyPreset(preset: Preset) {
    setSetup((current) => ({
      ...current,
      role: preset.role,
      level: preset.level,
      focus: preset.focus,
      interviewMode: preset.interviewMode
    }));
  }

  async function handleCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (turnstileSiteKey && !turnstileToken) {
      setError(
        "Please complete the bot verification before creating a session."
      );
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const authToken = await getAuthToken();
      const result = await createSession({
        clientId,
        role: setup.role,
        level: setup.level,
        focus: setup.focus,
        companyName: setup.companyName,
        cvText: setup.cvText,
        jobDescription: setup.jobDescription,
        interviewMode: setup.interviewMode,
        ...(turnstileToken ? { turnstileToken } : {}),
        authToken
      });
      await refreshSessions(result.sessionId);
      setMessages([]);
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create session."
      );
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    } finally {
      setIsCreating(false);
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
      | "scorecard"
      | "improve_answer"
      | "rubric"
  ) {
    if ((!content && action === "message") || !activeSessionId || isSending) {
      return;
    }

    if (action === "scorecard" || action === "improve_answer" || action === "rubric") {
      if (!lastUserMessage) {
        setError(
          "Answer at least one interview question before using that action."
        );
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
      const authToken = await getAuthToken();
      const result = await sendChatMessage({
        clientId,
        sessionId: activeSessionId,
        message: content,
        action,
        authToken
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
      setError(
        caught instanceof Error ? caught.message : "Could not send message."
      );
    } finally {
      setIsSending(false);
    }
  }

  function exportTranscript() {
    if (!activeSession) {
      return;
    }

    const lines = [
      `# Interview Coach Session`,
      "",
      `Role: ${activeSession.role}`,
      `Level: ${activeSession.level}`,
      `Focus: ${activeSession.focus}`,
      `Mode: ${INTERVIEW_MODE_LABELS[activeSession.interviewMode] ?? activeSession.interviewMode}`,
      ...(activeSession.companyName ? [`Company: ${activeSession.companyName}`] : []),
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

        <div className="sidebarTop">
          <button
            className="themeToggle"
            type="button"
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
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

          {/* Clerk UserButton rendered by the ClerkGate wrapper */}
          <div id="clerk-user-button-portal" className="userButtonWrapper" />
        </div>

        <div className="presetsSection">
          <div className="sessionListHeader">
            <Zap size={17} aria-hidden="true" />
            <span>Quick start</span>
          </div>
          <div className="presetList">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="presetButton"
                type="button"
                onClick={() => applyPreset(preset)}
                title={`${preset.role} — ${preset.focus}`}
              >
                {preset.label}
              </button>
            ))}
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
                setSetup((current) => ({
                  ...current,
                  role: event.target.value
                }))
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
                setSetup((current) => ({
                  ...current,
                  level: event.target.value
                }))
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

          <label>
            <span>
              <Target size={16} aria-hidden="true" />
              Focus
            </span>
            <input
              value={setup.focus}
              onChange={(event) =>
                setSetup((current) => ({
                  ...current,
                  focus: event.target.value
                }))
              }
              maxLength={160}
              required
            />
          </label>

          <label>
            <span>
              <Building2 size={16} aria-hidden="true" />
              Company (optional)
            </span>
            <input
              value={setup.companyName}
              onChange={(event) =>
                setSetup((current) => ({
                  ...current,
                  companyName: event.target.value
                }))
              }
              placeholder="e.g. Cloudflare"
              maxLength={120}
            />
          </label>

          <button
            className="cvToggle"
            type="button"
            onClick={() => setShowCvFields((v) => !v)}
          >
            <FileText size={15} aria-hidden="true" />
            {showCvFields ? "Hide CV & JD" : "Add CV & Job Description"}
          </button>

          {showCvFields && (
            <>
              <label>
                <span>CV / Resume (paste text)</span>
                <textarea
                  value={setup.cvText}
                  onChange={(event) =>
                    setSetup((current) => ({
                      ...current,
                      cvText: event.target.value
                    }))
                  }
                  placeholder="Paste your CV or résumé here..."
                  rows={5}
                  maxLength={6000}
                />
              </label>

              <label>
                <span>Job Description (paste text)</span>
                <textarea
                  value={setup.jobDescription}
                  onChange={(event) =>
                    setSetup((current) => ({
                      ...current,
                      jobDescription: event.target.value
                    }))
                  }
                  placeholder="Paste the job description here..."
                  rows={5}
                  maxLength={4000}
                />
              </label>
            </>
          )}

          {/* Turnstile bot-check widget */}
          {TurnstileWidget && turnstileSiteKey && (
            <Suspense fallback={null}>
              <TurnstileWidget
                ref={turnstileRef}
                siteKey={turnstileSiteKey}
                onSuccess={(token) => setTurnstileToken(token)}
                onExpire={() => setTurnstileToken(null)}
                onError={() => setTurnstileToken(null)}
              />
            </Suspense>
          )}

          <button
            className="primaryButton"
            type="submit"
            disabled={isCreating || (!!turnstileSiteKey && !turnstileToken)}
          >
            {isCreating ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <Plus size={18} />
            )}
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
                  {session.level} — {INTERVIEW_MODE_LABELS[session.interviewMode] ?? session.interviewMode}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="workspace" aria-label="Interview chat">
        <header className="chatHeader">
          <div>
            <p>
              {activeSession
                ? `${INTERVIEW_MODE_LABELS[activeSession.interviewMode] ?? activeSession.interviewMode}${activeSession.companyName ? ` — ${activeSession.companyName}` : ""}`
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

        {error && (
          <div className="errorBanner" role="alert">
            {error}
          </div>
        )}

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
                  ? "Use the action buttons below to get your first question or type your own answer."
                  : "Pick a quick-start preset on the left or fill in your role and focus, then click \"New session\"."}
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
          <button
            type="button"
            onClick={() => void sendContent("", "scorecard")}
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
            onClick={() => void sendContent("", "rubric")}
            disabled={!activeSession || isSending || !lastUserMessage}
          >
            <ClipboardCheck size={17} aria-hidden="true" />
            Rubric score
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
          <button
            className="sendButton"
            type="submit"
            disabled={!activeSession || !draft.trim() || isSending}
            aria-label="Send message"
            title="Send message"
          >
            {isSending ? (
              <Loader2 className="spin" size={20} />
            ) : (
              <Send size={20} />
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
