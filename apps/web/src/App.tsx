import {
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  Download,
  FileText,
  Loader2,
  LogIn,
  LogOut,
  Mic,
  MicOff,
  Moon,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Star,
  Sun,
  Target,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  WandSparkles,
  X
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  createSession,
  deleteSession,
  extractResume,
  listMessages,
  listReports,
  listSessions,
  streamChatMessage,
  updateSession
} from "./api";
import {
  getActiveStages,
  getCurrentStage,
  getDefaultInterviewPlan,
  updateStageQuestionCount
} from "./interviewPlan";
import {
  getBasicSuggestionOptions,
  getRoleSuggestionOptions,
  type SuggestionOption
} from "./suggestions";
import {
  getDefaultRubricPreset,
  RUBRIC_LABELS,
  RUBRIC_OPTIONS
} from "./rubrics";
import type {
  InterviewMode,
  InterviewPlan,
  Message,
  RubricPreset,
  Session,
  SessionReport,
  SessionType
} from "./types";

type SetupForm = {
  role: string;
  level: string;
  focus: string;
  cvText: string;
  jobDescription: string;
  companyName: string;
  sessionType: SessionType;
  interviewMode: InterviewMode;
  rubricPreset: RubricPreset;
  interviewPlan: InterviewPlan;
};

type ChatAction =
  | "message"
  | "first_question"
  | "next_question"
  | "technical_question"
  | "tailored_question"
  | "rubric_score"
  | "scorecard"
  | "improve_answer"
  | "generate_report";

type InlinePart =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "code"; value: string };

type LocalAccount = {
  id: string;
  email: string;
  name: string;
};

type GuidedAction = {
  action: ChatAction;
  label: string;
  detail: string;
  icon: ReactNode;
  disabled?: boolean;
  primary?: boolean;
};

const defaultSetup: SetupForm = {
  role: "Frontend Engineer",
  level: "Mid-level",
  focus: "Behavioral and technical communication",
  cvText: "",
  jobDescription: "",
  companyName: "",
  sessionType: "quick_practice",
  interviewMode: "behavioural",
  rubricPreset: "behavioral",
  interviewPlan: getDefaultInterviewPlan("quick_practice")
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

const LEVEL_SUGGESTIONS = [
  "Entry-level",
  "Junior",
  "Mid-level",
  "Senior",
  "Staff",
  "Principal",
  "Lead",
  "Manager"
];

const FOCUS_SUGGESTIONS = [
  "Behavioral and technical communication",
  "System design and tradeoffs",
  "Frontend architecture",
  "Backend architecture",
  "Debugging and incident response",
  "Algorithms and data structures",
  "Leadership and influence",
  "Project deep-dive",
  "Company motivation",
  "Weaknesses and growth areas",
  "Culture fit",
  "Resume-specific questions"
];

const requiresAnswer = new Set<ChatAction>([
  "scorecard",
  "rubric_score",
  "improve_answer",
  "generate_report"
]);

const themeStorageKey = "cf_ai_interview_coach_theme";
const accountStorageKey = "cf_ai_interview_coach_account";

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
    ? ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition ??
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

function getStoredAccount() {
  try {
    const raw = localStorage.getItem(accountStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LocalAccount>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.name === "string"
    ) {
      return parsed as LocalAccount;
    }
  } catch {
    localStorage.removeItem(accountStorageKey);
  }

  return null;
}

function createLocalAccount(input: { email: string; name: string }) {
  const account: LocalAccount = {
    id: `app:${crypto.randomUUID()}`,
    email: input.email.trim().toLowerCase(),
    name: input.name.trim()
  };

  localStorage.setItem(accountStorageKey, JSON.stringify(account));
  return account;
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

function SignInScreen({
  theme,
  onThemeToggle,
  onSignIn
}: {
  theme: "dark" | "light";
  onThemeToggle: () => void;
  onSignIn: (account: LocalAccount) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedName = name.trim() || trimmedEmail.split("@")[0] || "Candidate";

    if (!trimmedEmail) {
      return;
    }

    onSignIn(createLocalAccount({ email: trimmedEmail, name: trimmedName }));
  }

  return (
    <main className="signInShell">
      <section className="signInPanel" aria-label="Create profile">
        <div className="brand signInBrand">
          <div className="brandMark">
            <Bot size={24} aria-hidden="true" />
          </div>
          <div>
            <p>Cloudflare AI</p>
            <h1>Interview Coach</h1>
          </div>
        </div>

        <form className="signInForm" onSubmit={handleSubmit}>
          <div>
            <h2>Create Profile</h2>
            <p>
              Create a browser-backed practice profile. No password required.
            </p>
          </div>

          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              inputMode="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            <span>Name</span>
            <input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
            />
          </label>

          <button className="primaryButton" type="submit">
            <LogIn size={18} aria-hidden="true" />
            Create profile
          </button>
        </form>

        <button
          className="themeToggle signInThemeToggle"
          type="button"
          onClick={onThemeToggle}
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
      </section>
    </main>
  );
}

function GuidedInput({
  label,
  icon,
  value,
  onChange,
  suggestions,
  maxLength,
  required,
  placeholder,
  ariaLabel
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  suggestions: SuggestionOption[];
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <label className="guidedField">
      <span>
        {icon}
        {label}
      </span>
      <input
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        maxLength={maxLength}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
      />
      {isFocused && suggestions.length > 0 && (
        <div className="suggestionList" role="listbox" aria-label={`${label} suggestions`}>
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.label}-${suggestion.value}`}
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(suggestion.value);
                setIsFocused(false);
              }}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function InterviewPlanEditor({
  plan,
  onChange
}: {
  plan: InterviewPlan;
  onChange: (plan: InterviewPlan) => void;
}) {
  return (
    <div className="planEditor" aria-label="Interview format">
      <div className="planEditorHeader">
        <span>Interview format</span>
        <small>Adjust stages for this session</small>
      </div>
      <div className="planStageList">
        {plan.stages.map((stage) => (
          <div className="planStageRow" key={stage.id}>
            <div>
              <strong>{stage.label}</strong>
              <small>{stage.objective}</small>
            </div>
            <label>
              <span>Questions</span>
              <input
                type="number"
                min={0}
                max={6}
                value={stage.enabled ? stage.questionCount : 0}
                onChange={(event) =>
                  onChange(
                    updateStageQuestionCount(
                      plan,
                      stage.id,
                      Number(event.target.value)
                    )
                  )
                }
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function InterviewTimeline({ session }: { session: Session }) {
  const stages = getActiveStages(session.interviewPlan);
  const currentStage = getCurrentStage(session);

  if (stages.length === 0 || !currentStage) {
    return null;
  }

  return (
    <div className="interviewTimeline" aria-label="Interview progress">
      {stages.map((stage, index) => {
        const isCurrent =
          !session.interviewProgress.completed &&
          index === session.interviewProgress.stageIndex;
        const isComplete =
          session.interviewProgress.completed ||
          index < session.interviewProgress.stageIndex;
        const progressText = isCurrent
          ? `${Math.min(
              session.interviewProgress.questionInStage + 1,
              stage.questionCount
            )}/${stage.questionCount}`
          : `${stage.questionCount}`;

        return (
          <div
            className={`timelineStage ${isCurrent ? "current" : ""} ${
              isComplete ? "complete" : ""
            }`}
            key={stage.id}
          >
            <span>{stage.label}</span>
            <small>{isCurrent ? progressText : isComplete ? "Done" : progressText}</small>
          </div>
        );
      })}
    </div>
  );
}

function ReportLibrary({
  reports,
  activeReportId,
  onSelect,
  onExport
}: {
  reports: SessionReport[];
  activeReportId: string | null;
  onSelect: (reportId: string) => void;
  onExport: (report: SessionReport) => void;
}) {
  if (reports.length === 0) {
    return null;
  }

  const activeReport = reports.find((report) => report.id === activeReportId) ?? reports[0];

  return (
    <section className="reportLibrary" aria-label="Saved reports">
      <div className="reportList">
        <div className="reportListHeader">
          <FileText size={16} aria-hidden="true" />
          <span>Reports</span>
        </div>
        {reports.map((report) => (
          <button
            className={report.id === activeReport.id ? "active" : undefined}
            key={report.id}
            type="button"
            onClick={() => onSelect(report.id)}
          >
            <strong>{report.title}</strong>
            <span>
              {RUBRIC_LABELS[report.rubricPreset]} /{" "}
              {new Date(report.createdAt).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>

      <article className="reportPreview">
        <div className="reportPreviewHeader">
          <div>
            <span>{RUBRIC_LABELS[activeReport.rubricPreset]} report</span>
            <strong>{activeReport.title}</strong>
          </div>
          <button
            className="secondaryIconButton"
            type="button"
            onClick={() => onExport(activeReport)}
            aria-label="Export report"
            title="Export report"
          >
            <Download size={17} aria-hidden="true" />
          </button>
        </div>
        <MarkdownMessage content={activeReport.content} />
      </article>
    </section>
  );
}

function parseInlineMarkdown(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }

    const token = match[0];
    if (token.startsWith("**")) {
      parts.push({ kind: "strong", value: token.slice(2, -2) });
    } else {
      parts.push({ kind: "code", value: token.slice(1, -1) });
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return parts;
}

function renderInlineMarkdown(text: string) {
  return parseInlineMarkdown(text).map((part, index) => {
    if (part.kind === "strong") {
      return <strong key={index}>{part.value}</strong>;
    }

    if (part.kind === "code") {
      return <code key={index}>{part.value}</code>;
    }

    return <span key={index}>{part.value}</span>;
  });
}

function MarkdownMessage({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);

  return (
    <div className="messageContent">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim().length > 0);

        if (lines.length === 0) {
          return null;
        }

        if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineMarkdown(line.trim().replace(/^[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }

        if (lines.every((line) => /^\d+\.\s+/.test(line.trim()))) {
          return (
            <ol key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineMarkdown(line.trim().replace(/^\d+\.\s+/, ""))}
                </li>
              ))}
            </ol>
          );
        }

        if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
          return (
            <h3 key={blockIndex}>
              {renderInlineMarkdown(lines[0].replace(/^#{1,3}\s+/, ""))}
            </h3>
          );
        }

        return (
          <p key={blockIndex}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                {renderInlineMarkdown(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const [account, setAccount] = useState<LocalAccount | null>(getStoredAccount);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reports, setReports] = useState<SessionReport[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [setup, setSetup] = useState(defaultSetup);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSetup, setEditSetup] = useState(defaultSetup);
  const [draft, setDraft] = useState("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resumeUploadStatus, setResumeUploadStatus] = useState<string | null>(null);
  const [editResumeUploadStatus, setEditResumeUploadStatus] = useState<string | null>(
    null
  );
  const [responseTimerSeconds, setResponseTimerSeconds] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStartedRef = useRef(false);

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
  const hasAssistantQuestion = messages.some(
    (message) => message.role === "assistant"
  );
  const guidedActions = useMemo<GuidedAction[]>(() => {
    if (!activeSession) {
      return [];
    }

    const hasAnswer = Boolean(lastUserMessage);
    const planComplete = activeSession.interviewProgress.completed;
    const isTechnical =
      activeSession.interviewMode === "technical" ||
      activeSession.sessionType === "technical_screen";
    const isCompany =
      activeSession.interviewMode === "company_motivation" ||
      activeSession.sessionType === "company_specific";
    const isDeepDive = activeSession.interviewMode === "project_deep_dive";
    const actions: GuidedAction[] = [
      {
        action: planComplete
          ? "generate_report"
          : hasAssistantQuestion
            ? "next_question"
            : "first_question",
        label: planComplete
          ? "Generate final report"
          : hasAssistantQuestion
            ? "Next guided question"
            : "Start interview",
        detail: planComplete
          ? "The structured interview plan is complete."
          : hasAssistantQuestion
            ? "Move to the next stage-aware interview question."
            : "Begin with the first question in the interview plan.",
        icon: planComplete ? (
          <ClipboardCheck size={17} aria-hidden="true" />
        ) : (
          <MessageSquareText size={17} aria-hidden="true" />
        ),
        primary: true
      }
    ];

    if (!planComplete && isTechnical) {
      actions.push({
        action: "technical_question",
        label: "Technical drill",
        detail: "Scenario-based question with tradeoffs and edge cases.",
        icon: <TerminalSquare size={17} aria-hidden="true" />
      });
    } else if (!planComplete && isCompany && hasTailoring) {
      actions.push({
        action: "tailored_question",
        label: "Company-tailored question",
        detail: "Use the company, CV, and job description context.",
        icon: <FileText size={17} aria-hidden="true" />
      });
    } else if (!planComplete && isDeepDive) {
      actions.push({
        action: "tailored_question",
        label: "Project deep-dive",
        detail: "Probe decisions, tradeoffs, outcomes, and lessons.",
        icon: <FileText size={17} aria-hidden="true" />,
        disabled: !hasTailoring
      });
    } else if (!planComplete && hasTailoring) {
      actions.push({
        action: "tailored_question",
        label: "Tailored question",
        detail: "Pull from the CV or job description.",
        icon: <FileText size={17} aria-hidden="true" />
      });
    }

    if (hasAnswer) {
      actions.push(
        {
          action: "improve_answer",
          label: "Improve last answer",
          detail: "Rewrite the answer with clearer evidence.",
          icon: <WandSparkles size={17} aria-hidden="true" />
        },
        {
          action: isTechnical ? "rubric_score" : "scorecard",
          label: isTechnical ? "Technical score" : "Scorecard",
          detail: isTechnical
            ? "Score correctness, depth, tradeoffs, and clarity."
            : "Summarize readiness, signal, risks, and next drill.",
          icon: <Star size={17} aria-hidden="true" />
        },
        {
          action: "generate_report",
          label: "Final report",
          detail: "Create a session summary when you are done.",
          icon: <ClipboardCheck size={17} aria-hidden="true" />
        }
      );
    }

    return actions;
  }, [
    activeSession,
    hasAssistantQuestion,
    hasTailoring,
    lastUserMessage
  ]);
  const timerClass =
    responseTimerSeconds >= 180
      ? "responseTimer danger"
      : responseTimerSeconds >= 120
        ? "responseTimer warn"
        : "responseTimer";
  const clientId = account?.id ?? "";

  useEffect(() => {
    if (!account) {
      setIsLoadingSessions(false);
      return;
    }

    void refreshSessions();
  }, [account?.id]);

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

  useEffect(() => {
    const hasDraft = draft.trim().length > 0;

    if (hasDraft && !timerStartedRef.current) {
      timerStartedRef.current = true;
      setResponseTimerSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setResponseTimerSeconds((seconds) => seconds + 1);
      }, 1000);
    }

    if (!hasDraft && timerStartedRef.current) {
      timerStartedRef.current = false;
      if (timerIntervalRef.current !== null) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      setResponseTimerSeconds(0);
    }

    return () => {
      if (timerIntervalRef.current !== null) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [draft]);

  async function refreshSessions(nextActiveId?: string) {
    if (!account) {
      return;
    }

    setIsLoadingSessions(true);
    setError(null);

    try {
      const result = await listSessions(clientId);
      setSessions(result.sessions);

      const preferredId =
        nextActiveId ??
        (activeSessionId &&
        result.sessions.some((session) => session.id === activeSessionId)
          ? activeSessionId
          : result.sessions[0]?.id);

      if (preferredId) {
        setActiveSessionId(preferredId);
        await loadMessages(preferredId);
      } else {
        setActiveSessionId(null);
        setMessages([]);
        setReports([]);
        setActiveReportId(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load sessions.");
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function loadMessages(sessionId: string) {
    if (!account) {
      return;
    }

    setIsLoadingMessages(true);
    setError(null);

    try {
      const result = await listMessages(clientId, sessionId);
      setMessages(result.messages);
      setActiveSessionId(sessionId);
      await refreshReports(sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load messages.");
    } finally {
      setIsLoadingMessages(false);
    }
  }

  async function refreshReports(sessionId = activeSessionId ?? "") {
    if (!account || !sessionId) {
      setReports([]);
      setActiveReportId(null);
      return;
    }

    const result = await listReports(clientId, sessionId);
    setReports(result.reports);
    setActiveReportId((current) =>
      current && result.reports.some((report) => report.id === current)
        ? current
        : result.reports[0]?.id ?? null
    );
  }

  async function handleCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) {
      return;
    }
    setIsCreating(true);
    setError(null);

    try {
      const result = await createSession({ clientId, ...setup });
      await refreshSessions(result.sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create session.");
    } finally {
      setIsCreating(false);
    }
  }

  function startEditingSession(session: Session) {
    setEditingSessionId(session.id);
    setEditResumeUploadStatus(null);
    setEditSetup({
      ...defaultSetup,
      role: session.role,
      level: session.level,
      focus: session.focus,
      cvText: session.cvText,
      jobDescription: session.jobDescription,
      companyName: session.companyName,
        sessionType: session.sessionType,
        interviewMode: session.interviewMode,
        rubricPreset: session.rubricPreset,
        interviewPlan: session.interviewPlan
      });
  }

  async function handleUpdateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingSessionId || !account) {
      return;
    }

    setIsSavingSession(true);
    setError(null);

    try {
      await updateSession({
        clientId,
        sessionId: editingSessionId,
        role: editSetup.role,
        level: editSetup.level,
        focus: editSetup.focus,
        cvText: editSetup.cvText,
        jobDescription: editSetup.jobDescription,
        companyName: editSetup.companyName,
        sessionType: editSetup.sessionType,
        interviewMode: editSetup.interviewMode,
        rubricPreset: editSetup.rubricPreset,
        interviewPlan: editSetup.interviewPlan
      });
      setEditingSessionId(null);
      await refreshSessions(editingSessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update session.");
    } finally {
      setIsSavingSession(false);
    }
  }

  async function handleResumeFile(
    event: ChangeEvent<HTMLInputElement>,
    target: "setup" | "edit"
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!account) {
      return;
    }

    const setStatus =
      target === "setup" ? setResumeUploadStatus : setEditResumeUploadStatus;
    setStatus(`Reading ${file.name}...`);
    setError(null);

    try {
      const result = await extractResume({ clientId, file });
      const clippedText = result.text.slice(0, 8000);

      if (target === "setup") {
        setSetup((current) => ({ ...current, cvText: clippedText }));
      } else {
        setEditSetup((current) => ({ ...current, cvText: clippedText }));
      }

      setStatus(
        result.text.length > 8000
          ? `Loaded ${result.fileName}. Trimmed to the first 8,000 characters.`
          : `Loaded ${result.fileName}. ${result.characterCount.toLocaleString()} readable characters.`
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not read that resume file.";
      setStatus(message);
      setError(message);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    if (!account) {
      return;
    }

    if (!confirm("Delete this session and all its messages?")) {
      return;
    }

    setDeletingSessionId(sessionId);
    setError(null);

    try {
      await deleteSession(clientId, sessionId);

      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
        setReports([]);
        setActiveReportId(null);
      }

      await refreshSessions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete session.");
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendContent(draft.trim(), "message");
  }

  async function sendContent(content: string, action: ChatAction) {
    if (
      (!content && action === "message") ||
      !activeSessionId ||
      isSending ||
      !account
    ) {
      return;
    }

    if (requiresAnswer.has(action) && !lastUserMessage) {
      setError("Answer at least one interview question before using that action.");
      return;
    }

    let optimisticId: number | null = null;
    const streamingId = Date.now() * -1 - 1;

    if (action === "message") {
      const nextOptimisticId = Date.now() * -1;
      optimisticId = nextOptimisticId;
      setDraft("");
      setMessages((current) => [
        ...current,
        {
          id: nextOptimisticId,
          sessionId: activeSessionId,
          role: "user",
          content,
          createdAt: new Date().toISOString()
        }
      ]);
    }

    setIsSending(true);
    setStreamingMessageId(streamingId);
    setMessages((current) => [
      ...current,
      {
        id: streamingId,
        sessionId: activeSessionId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString()
      }
    ]);
    setError(null);

    try {
      const result = await streamChatMessage(
        {
          clientId,
          sessionId: activeSessionId,
          message: content,
          action
        },
        (delta) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === streamingId
                ? { ...message, content: `${message.content}${delta}` }
                : message
            )
          );
        }
      );

      setMessages((current) =>
        current.map((message) =>
          message.id === streamingId ? { ...message, content: result.reply } : message
        )
      );
      if (action === "generate_report") {
        await refreshReports(activeSessionId);
      }
      void refreshSessions(activeSessionId);
    } catch (caught) {
      setMessages((current) =>
        current.filter((message) => message.id !== streamingId)
      );
      if (optimisticId) {
        setMessages((current) =>
          current.filter((message) => message.id !== optimisticId)
        );
        setDraft(content);
      }
      setError(caught instanceof Error ? caught.message : "Could not send message.");
    } finally {
      setIsSending(false);
      setStreamingMessageId(null);
    }
  }

  function exportTranscript() {
    if (!activeSession) {
      return;
    }

    const sessionTypeLabel =
      SESSION_TYPE_LABELS[activeSession.sessionType] ?? activeSession.sessionType;
    const modeLabel =
      INTERVIEW_MODE_LABELS[activeSession.interviewMode] ??
      activeSession.interviewMode;

    const lines = [
      "# Interview Coach Session",
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

  function exportReport(report: SessionReport) {
    const blob = new Blob([report.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `interview-report-${report.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleVoiceInput() {
    if (!SpeechRecognitionAPI) {
      return;
    }

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

  function handleSignOut() {
    localStorage.removeItem(accountStorageKey);
    setAccount(null);
    setSessions([]);
    setMessages([]);
    setReports([]);
    setActiveReportId(null);
    setActiveSessionId(null);
    setError(null);
  }

  if (!account) {
    return (
      <SignInScreen
        theme={theme}
        onThemeToggle={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        onSignIn={setAccount}
      />
    );
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

        <div className="accountPanel">
          <div className="accountIdentity">
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>{account.name}</strong>
              <span>{account.email}</span>
            </div>
          </div>
          <button className="accountLink" type="button" onClick={handleSignOut}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>

        <form className="setupPanel" onSubmit={handleCreateSession}>
          <GuidedInput
            label="Role"
            icon={<BriefcaseBusiness size={16} aria-hidden="true" />}
            value={setup.role}
            onChange={(role) => setSetup((current) => ({ ...current, role }))}
            suggestions={getRoleSuggestionOptions(setup.role)}
            maxLength={120}
            required
          />

          <GuidedInput
            label="Level"
            icon={<UserRound size={16} aria-hidden="true" />}
            value={setup.level}
            onChange={(level) => setSetup((current) => ({ ...current, level }))}
            suggestions={getBasicSuggestionOptions(setup.level, LEVEL_SUGGESTIONS)}
            maxLength={80}
            required
          />

          <GuidedInput
            label="Focus"
            icon={<Target size={16} aria-hidden="true" />}
            value={setup.focus}
            onChange={(focus) => setSetup((current) => ({ ...current, focus }))}
            suggestions={getBasicSuggestionOptions(setup.focus, FOCUS_SUGGESTIONS)}
            maxLength={160}
            required
          />

          <label>
            <span>
              <TerminalSquare size={16} aria-hidden="true" />
              Session type
            </span>
            <select
              value={setup.sessionType}
              onChange={(event) => {
                const sessionType = event.target.value as SessionType;
                setSetup((current) => ({
                  ...current,
                  sessionType,
                  rubricPreset: getDefaultRubricPreset({
                    role: current.role,
                    focus: current.focus,
                    sessionType,
                    interviewMode: current.interviewMode
                  }),
                  interviewPlan: getDefaultInterviewPlan(sessionType)
                }));
              }}
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

          <InterviewPlanEditor
            plan={setup.interviewPlan}
            onChange={(interviewPlan) =>
              setSetup((current) => ({ ...current, interviewPlan }))
            }
          />

          <label>
            <span>
              <ClipboardCheck size={16} aria-hidden="true" />
              Interview mode
            </span>
            <select
              value={setup.interviewMode}
              onChange={(event) => {
                const interviewMode = event.target.value as InterviewMode;
                setSetup((current) => ({
                  ...current,
                  interviewMode,
                  rubricPreset: getDefaultRubricPreset({
                    role: current.role,
                    focus: current.focus,
                    sessionType: current.sessionType,
                    interviewMode
                  })
                }));
              }}
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
              <Star size={16} aria-hidden="true" />
              Scoring rubric
            </span>
            <select
              value={setup.rubricPreset}
              onChange={(event) =>
                setSetup((current) => ({
                  ...current,
                  rubricPreset: event.target.value as RubricPreset
                }))
              }
            >
              {RUBRIC_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            className="advancedToggle"
            type="button"
            onClick={() => setShowAdvanced((current) => !current)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? (
              <ChevronUp size={15} aria-hidden="true" />
            ) : (
              <ChevronDown size={15} aria-hidden="true" />
            )}
            {showAdvanced ? "Hide" : "Add"} CV and job description
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

              <div className="fieldGroup">
                <span>Your CV / resume (optional)</span>
                <div className="fileUploadRow">
                  <label className="fileUploadButton">
                    <Upload size={16} aria-hidden="true" />
                    Upload resume
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                      onChange={(event) => void handleResumeFile(event, "setup")}
                    />
                  </label>
                  {resumeUploadStatus && (
                    <span className="uploadStatus">{resumeUploadStatus}</span>
                  )}
                </div>
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
              </div>

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
            sessions.map((session) =>
              editingSessionId === session.id ? (
                <form
                  className="sessionEditForm"
                  key={session.id}
                  onSubmit={handleUpdateSession}
                >
                  <GuidedInput
                    label="Role"
                    ariaLabel="Session role"
                    value={editSetup.role}
                    onChange={(role) =>
                      setEditSetup((current) => ({ ...current, role }))
                    }
                    suggestions={getRoleSuggestionOptions(editSetup.role)}
                    maxLength={120}
                    required
                  />
                  <GuidedInput
                    label="Level"
                    ariaLabel="Session level"
                    value={editSetup.level}
                    onChange={(level) =>
                      setEditSetup((current) => ({ ...current, level }))
                    }
                    suggestions={getBasicSuggestionOptions(
                      editSetup.level,
                      LEVEL_SUGGESTIONS
                    )}
                    maxLength={80}
                    required
                  />
                  <GuidedInput
                    label="Focus"
                    ariaLabel="Session focus"
                    value={editSetup.focus}
                    onChange={(focus) =>
                      setEditSetup((current) => ({ ...current, focus }))
                    }
                    suggestions={getBasicSuggestionOptions(
                      editSetup.focus,
                      FOCUS_SUGGESTIONS
                    )}
                    maxLength={160}
                    required
                  />
                  <select
                    aria-label="Session type"
                    value={editSetup.sessionType}
                    onChange={(event) => {
                      const sessionType = event.target.value as SessionType;
                      setEditSetup((current) => ({
                        ...current,
                        sessionType,
                        rubricPreset: getDefaultRubricPreset({
                          role: current.role,
                          focus: current.focus,
                          sessionType,
                          interviewMode: current.interviewMode
                        }),
                        interviewPlan: getDefaultInterviewPlan(sessionType)
                      }));
                    }}
                  >
                    {(Object.entries(SESSION_TYPE_LABELS) as [
                      SessionType,
                      string
                    ][]).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <InterviewPlanEditor
                    plan={editSetup.interviewPlan}
                    onChange={(interviewPlan) =>
                      setEditSetup((current) => ({ ...current, interviewPlan }))
                    }
                  />
                  <select
                    aria-label="Interview mode"
                    value={editSetup.interviewMode}
                    onChange={(event) => {
                      const interviewMode = event.target.value as InterviewMode;
                      setEditSetup((current) => ({
                        ...current,
                        interviewMode,
                        rubricPreset: getDefaultRubricPreset({
                          role: current.role,
                          focus: current.focus,
                          sessionType: current.sessionType,
                          interviewMode
                        })
                      }));
                    }}
                  >
                    {(Object.entries(INTERVIEW_MODE_LABELS) as [
                      InterviewMode,
                      string
                    ][]).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Scoring rubric"
                    value={editSetup.rubricPreset}
                    onChange={(event) =>
                      setEditSetup((current) => ({
                        ...current,
                        rubricPreset: event.target.value as RubricPreset
                      }))
                    }
                  >
                    {RUBRIC_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Company name"
                    value={editSetup.companyName}
                    onChange={(event) =>
                      setEditSetup((current) => ({
                        ...current,
                        companyName: event.target.value
                      }))
                    }
                    placeholder="Company name"
                    maxLength={240}
                  />
                  <div className="fieldGroup compact">
                    <span>CV or resume</span>
                    <div className="fileUploadRow">
                      <label className="fileUploadButton compact">
                        <Upload size={15} aria-hidden="true" />
                        Upload
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                          onChange={(event) => void handleResumeFile(event, "edit")}
                        />
                      </label>
                      {editResumeUploadStatus && (
                        <span className="uploadStatus">
                          {editResumeUploadStatus}
                        </span>
                      )}
                    </div>
                    <textarea
                      className="sessionEditTextarea"
                      aria-label="CV or resume"
                      value={editSetup.cvText}
                      onChange={(event) =>
                        setEditSetup((current) => ({
                          ...current,
                          cvText: event.target.value
                        }))
                      }
                      placeholder="CV or resume"
                      maxLength={8000}
                      rows={3}
                    />
                  </div>
                  <textarea
                    className="sessionEditTextarea"
                    aria-label="Job description"
                    value={editSetup.jobDescription}
                    onChange={(event) =>
                      setEditSetup((current) => ({
                        ...current,
                        jobDescription: event.target.value
                      }))
                    }
                    placeholder="Job description"
                    maxLength={4000}
                    rows={3}
                  />
                  <div className="sessionEditActions">
                    <button type="submit" disabled={isSavingSession}>
                      {isSavingSession ? (
                        <Loader2 className="spin" size={16} aria-hidden="true" />
                      ) : (
                        <Save size={16} aria-hidden="true" />
                      )}
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSessionId(null)}
                      disabled={isSavingSession}
                    >
                      <X size={16} aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
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
                      {session.level} -{" "}
                      {INTERVIEW_MODE_LABELS[session.interviewMode] ??
                        session.interviewMode}
                    </span>
                    {session.companyName && (
                      <span className="sessionCompany">{session.companyName}</span>
                    )}
                  </button>
                  <div className="sessionActions">
                    <button
                      type="button"
                      onClick={() => startEditingSession(session)}
                      aria-label={`Edit ${session.role} session`}
                      title="Edit session"
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSession(session.id)}
                      disabled={deletingSessionId === session.id}
                      aria-label={`Delete ${session.role} session`}
                      title="Delete session"
                    >
                      {deletingSessionId === session.id ? (
                        <Loader2 className="spin" size={15} aria-hidden="true" />
                      ) : (
                        <Trash2 size={15} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              )
            )
          )}
        </div>
      </aside>

      <section className="workspace" aria-label="Interview chat">
        <header className="chatHeader">
          <div>
            <p>
              {activeSession
                ? `${SESSION_TYPE_LABELS[activeSession.sessionType] ?? activeSession.sessionType} / ${INTERVIEW_MODE_LABELS[activeSession.interviewMode] ?? activeSession.interviewMode}${activeSession.companyName ? ` / ${activeSession.companyName}` : ""}`
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

        {activeSession && <InterviewTimeline session={activeSession} />}

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
                  : "Welcome back. Set up your next practice session."}
              </h3>
              <p>
                {activeSession
                  ? hasTailoring
                    ? "CV and job description loaded. Use Tailored question for personalised questions."
                    : "The coach will keep memory and adapt feedback as the interview develops."
                  : "Your sessions are saved to this browser profile. Choose a role, pick an interview mode, and add a CV or job description when you want tailored questions."}
              </p>
              {!activeSession && (
                <div className="onboardingSteps" aria-label="Getting started">
                  <span>1. Pick a role</span>
                  <span>2. Choose a mode</span>
                  <span>3. Start practicing</span>
                </div>
              )}
            </div>
          ) : (
            messages.map((message) => {
              const isStreamingAssistant = message.id === streamingMessageId;

              return (
                <article
                  className={`message ${message.role} ${
                    isStreamingAssistant && !message.content ? "pending" : ""
                  }`}
                  key={message.id}
                >
                  <div className="messageAvatar">
                    {message.role === "assistant" ? (
                      <Bot size={18} aria-hidden="true" />
                    ) : (
                      <UserRound size={18} aria-hidden="true" />
                    )}
                  </div>
                  <MarkdownMessage
                    content={
                      isStreamingAssistant && !message.content
                        ? "Reviewing your answer..."
                        : message.content
                    }
                  />
                </article>
              );
            })
          )}

          {isSending && streamingMessageId === null && (
            <article className="message assistant pending">
              <div className="messageAvatar">
                <Loader2 className="spin" size={18} aria-hidden="true" />
              </div>
              <MarkdownMessage content="Reviewing your answer..." />
            </article>
          )}
        </div>

        {activeSession?.interviewProgress.completed && reports.length === 0 && (
          <section className="completionPanel" aria-label="Interview complete">
            <div>
              <span>Interview complete</span>
              <strong>Generate the final coaching report for CV and job-fit feedback.</strong>
            </div>
            <button
              type="button"
              onClick={() => void sendContent("", "generate_report")}
              disabled={isSending || !lastUserMessage}
            >
              <ClipboardCheck size={17} aria-hidden="true" />
              Generate report
            </button>
          </section>
        )}

        <ReportLibrary
          reports={reports}
          activeReportId={activeReportId}
          onSelect={setActiveReportId}
          onExport={exportReport}
        />

        <div className="guidedActions" aria-label="Guided coaching actions">
          <div className="guidedActionsHeader">
            <div>
              <span>Guided next step</span>
              <strong>
                {activeSession
                  ? INTERVIEW_MODE_LABELS[activeSession.interviewMode]
                  : "Create a session"}
              </strong>
            </div>
            <button
              className="secondaryIconButton"
              type="button"
              onClick={exportTranscript}
              disabled={!activeSession || messages.length === 0}
              aria-label="Export transcript"
              title="Export transcript"
            >
              <Download size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="guidedActionList">
            {guidedActions.length === 0 ? (
              <p className="muted">Create a session to unlock guided actions.</p>
            ) : (
              guidedActions.map((item) => (
                <button
                  key={`${item.action}-${item.label}`}
                  className={item.primary ? "primaryGuidedAction" : undefined}
                  type="button"
                  onClick={() =>
                    void sendContent(
                      item.action === "improve_answer"
                        ? lastUserMessage?.content ?? ""
                        : "",
                      item.action
                    )
                  }
                  disabled={isSending || item.disabled}
                >
                  {item.icon}
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <form className="composer" onSubmit={handleSend}>
          {responseTimerSeconds > 0 && (
            <div className={timerClass} aria-label="Response timer" aria-live="off">
              <Clock size={13} aria-hidden="true" />
              {formatTimer(responseTimerSeconds)}
            </div>
          )}
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
