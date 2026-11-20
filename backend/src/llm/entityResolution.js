const PERSON_NAME_RE =
  /\b(?:Jensen\s+Huang|Tim\s+Cook|Satya\s+Nadella|Elon\s+Musk|Sundar\s+Pichai|Steve\s+Burd)\b/g;
const GENERIC_PERSON_NAME_RE =
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g;

const PRONOUN_RE = /\b(?:he|she|they|it|that|this|previous|former|earlier)\b/i;
const CORPORATE_ROLE_RE = /\b(ceo|chief executive|chairman|chairwoman|president|founder|director)\b/i;
const ORGANIZATION_RE = /\b(NVIDIA|Microsoft|Apple|Google|Tesla|Alphabet|Amazon)\b/gi;

function completedExchanges(conversation) {
  const exchanges = [];
  let pendingUser = null;
  for (const message of Array.isArray(conversation) ? conversation : []) {
    if (!message || !["user", "assistant"].includes(message.role) ||
        (message.status && message.status !== "completed") ||
        typeof message.content !== "string") continue;
    if (message.role === "user") pendingUser = message;
    else if (pendingUser) {
      exchanges.push([pendingUser, message]);
      pendingUser = null;
    }
  }
  return exchanges;
}

function extractNames(text) {
  const names = [];
  const excludedFirstWords = new Set([
    "Did", "Does", "Do", "For", "How", "Why", "When", "Where", "Who",
    "What", "Which", "The", "That", "This", "Chinese", "Latest", "Previous",
  ]);
  const candidates = [
    ...String(text || "").matchAll(PERSON_NAME_RE),
    ...String(text || "").matchAll(GENERIC_PERSON_NAME_RE),
  ];
  for (const match of candidates) {
    const name = match[0].trim();
    const firstWord = name.split(/\s+/)[0];
    if (!excludedFirstWords.has(firstWord) && !names.includes(name)) names.push(name);
  }
  return names;
}

function extractOrganizations(text) {
  const organizations = [];
  for (const match of String(text || "").matchAll(ORGANIZATION_RE)) {
    const organization = match[0].trim();
    if (!organizations.some((item) => item.toLowerCase() === organization.toLowerCase())) {
      organizations.push(organization);
    }
  }
  return organizations;
}

export function resolveConversationEntities(question, conversation = []) {
  const originalQuery = typeof question === "string" ? question.trim() : "";
  const exchanges = completedExchanges(conversation);
  const explicitNames = extractNames(originalQuery);

  const priorNames = [];
  const priorOrganizations = [];
  for (const [userMessage, assistantMessage] of exchanges) {
    extractNames(userMessage.content).forEach((name) => {
      if (!priorNames.includes(name)) priorNames.push(name);
    });
    extractOrganizations(userMessage.content).forEach((organization) => {
      if (!priorOrganizations.includes(organization)) priorOrganizations.push(organization);
    });
  }

  const hasReference = PRONOUN_RE.test(originalQuery);
  let resolvedEntity = null;
  let status = "none";

  if (explicitNames.length === 1) {
    resolvedEntity = explicitNames[0];
    status = "explicit";
  } else if (explicitNames.length > 1) {
    status = "ambiguous";
  } else if (hasReference || /^(why|who|when|how|where)\b/i.test(originalQuery)) {
    if (priorNames.length === 1) {
      resolvedEntity = priorNames[0];
      status = "resolved";
    } else if (priorNames.length > 1) {
      status = "ambiguous";
    }
  }

  const relationship = CORPORATE_ROLE_RE.test(originalQuery)
    ? originalQuery.match(CORPORATE_ROLE_RE)?.[0]?.toLowerCase() || null
    : null;
  const organizations = extractOrganizations(originalQuery);
  const organization = organizations[0] ||
    (resolvedEntity && priorOrganizations.length === 1 ? priorOrganizations[0] : null);
  const entityContext = resolvedEntity
    ? {
        canonicalName: resolvedEntity,
        type: "person",
        aliases: resolvedEntity.split(/\s+/).slice(0, 1),
        relationships: relationship && organization
          ? [{ relation: relationship, organization }]
          : [],
      }
    : null;

  let resolvedQuery = originalQuery;
  if (resolvedEntity && hasReference) {
    resolvedQuery = originalQuery
      .replace(/\bhe\b/gi, resolvedEntity)
      .replace(/\bshe\b/gi, resolvedEntity)
      .replace(/\bthey\b/gi, resolvedEntity)
      .replace(/\bit\b/gi, resolvedEntity)
      .replace(/\bthat\b/gi, resolvedEntity);
  } else if (resolvedEntity && /^(why|who|when|how|where)\b/i.test(originalQuery)) {
    resolvedQuery = `${resolvedEntity} ${originalQuery}`;
  }

  if (resolvedEntity && CORPORATE_ROLE_RE.test(originalQuery)) {
    const role = originalQuery.match(CORPORATE_ROLE_RE)?.[0] || "CEO";
    resolvedQuery = `${resolvedEntity} ${organization || ""} ${role} tenure`.replace(/\s+/g, " ").trim();
  }

  return {
    status,
    resolvedEntity,
    entities: entityContext ? [entityContext] : [],
    organizations,
    relationship,
    resolvedQuery,
    isFollowUp: exchanges.length > 0 && (
      hasReference ||
      /^(why|who|when|how|where)\b/i.test(originalQuery)
    ),
  };
}
