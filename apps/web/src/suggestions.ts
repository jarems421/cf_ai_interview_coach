export type SuggestionOption = {
  label: string;
  value: string;
};

type RoleSuggestion = {
  label: string;
  keywords: string[];
};

const roleSuggestions: RoleSuggestion[] = [
  {
    label: "Frontend Engineer",
    keywords: ["frontend", "front end", "react", "ui engineer", "javascript"]
  },
  {
    label: "Backend Engineer",
    keywords: ["backend", "back end", "api", "server", "node", "database"]
  },
  {
    label: "Full-stack Engineer",
    keywords: ["fullstack", "full stack", "frontend", "backend", "web"]
  },
  {
    label: "Software Engineer",
    keywords: ["software", "developer", "programmer", "engineer"]
  },
  {
    label: "Cloudflare Developer",
    keywords: ["cloudflare", "workers", "pages", "d1", "edge"]
  },
  {
    label: "DevOps Engineer",
    keywords: ["devops", "ci cd", "deployment", "automation", "terraform"]
  },
  {
    label: "Platform Engineer",
    keywords: ["platform", "infrastructure", "internal developer platform"]
  },
  {
    label: "Site Reliability Engineer",
    keywords: ["sre", "reliability", "incident", "observability", "on call"]
  },
  {
    label: "Cloud Engineer",
    keywords: ["cloud", "aws", "azure", "gcp", "infrastructure"]
  },
  {
    label: "Cloud Security Engineer",
    keywords: ["cloud security", "cybersecurity", "security", "iam", "zero trust"]
  },
  {
    label: "Security Engineer",
    keywords: ["security", "cybersecurity", "cyber security", "infosec"]
  },
  {
    label: "Cybersecurity Analyst",
    keywords: ["cybersecurity", "cyber security", "security analyst", "infosec"]
  },
  {
    label: "SOC Analyst",
    keywords: ["soc", "security operations", "cybersecurity", "threat monitoring"]
  },
  {
    label: "Application Security Engineer",
    keywords: ["appsec", "application security", "cybersecurity", "secure code"]
  },
  {
    label: "Penetration Tester",
    keywords: ["pentest", "penetration", "ethical hacker", "cybersecurity"]
  },
  {
    label: "Data Engineer",
    keywords: ["data", "etl", "pipeline", "warehouse", "analytics"]
  },
  {
    label: "Machine Learning Engineer",
    keywords: ["machine learning", "ml", "ai", "model", "llm"]
  },
  {
    label: "Data Analyst",
    keywords: ["data analyst", "analytics", "sql", "dashboard"]
  },
  {
    label: "Product Manager",
    keywords: ["product", "pm", "roadmap", "strategy"]
  },
  {
    label: "Engineering Manager",
    keywords: ["manager", "leadership", "people management", "engineering manager"]
  },
  {
    label: "Solutions Engineer",
    keywords: ["solutions", "sales engineer", "customer technical", "pre sales"]
  },
  {
    label: "Customer Success Manager",
    keywords: ["customer success", "csm", "account", "customer"]
  },
  {
    label: "Technical Support Engineer",
    keywords: ["support", "technical support", "troubleshooting", "customer"]
  },
  {
    label: "UX Designer",
    keywords: ["ux", "design", "designer", "user experience"]
  },
  {
    label: "Product Designer",
    keywords: ["product design", "designer", "ux", "ui"]
  }
];

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function scoreRoleSuggestion(query: string, suggestion: RoleSuggestion) {
  const label = normalize(suggestion.label);
  const keywords = suggestion.keywords.map(normalize);

  if (!query) {
    return 1;
  }

  if (label === query) {
    return 100;
  }

  if (label.startsWith(query)) {
    return 90;
  }

  if (label.includes(query)) {
    return 80;
  }

  const keywordMatch = keywords.find((keyword) => keyword.includes(query));
  if (keywordMatch) {
    return keywordMatch === query ? 78 : 68;
  }

  const queryTokens = query.split(" ").filter(Boolean);
  const searchable = [label, ...keywords].join(" ");
  const matchingTokens = queryTokens.filter((token) => searchable.includes(token));

  if (matchingTokens.length === queryTokens.length && queryTokens.length > 0) {
    return 58 + matchingTokens.length;
  }

  return 0;
}

export function getRoleSuggestionOptions(value: string, limit = 5) {
  const query = normalize(value);
  const exactValue = normalize(value);
  const matches = roleSuggestions
    .map((suggestion, index) => ({
      index,
      option: { label: suggestion.label, value: suggestion.label },
      score: scoreRoleSuggestion(query, suggestion)
    }))
    .filter((match) => match.score > 0 && normalize(match.option.value) !== exactValue)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((match) => match.option);

  const trimmed = value.trim();
  if (
    trimmed &&
    trimmed.length <= 120 &&
    !matches.some((match) => normalize(match.value) === exactValue) &&
    !roleSuggestions.some((suggestion) => normalize(suggestion.label) === exactValue)
  ) {
    matches.push({
      label: `Use "${trimmed}"`,
      value: trimmed
    });
  }

  return matches;
}

export function getBasicSuggestionOptions(value: string, suggestions: string[], limit = 5) {
  const query = normalize(value);
  return (query
    ? suggestions.filter((suggestion) => normalize(suggestion).includes(query))
    : suggestions
  )
    .filter((suggestion) => normalize(suggestion) !== query)
    .slice(0, limit)
    .map((suggestion) => ({ label: suggestion, value: suggestion }));
}
