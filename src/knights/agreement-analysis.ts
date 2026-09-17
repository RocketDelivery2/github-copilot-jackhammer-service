import type { ProviderId } from '../providers/types.js';
import type { RoundOneAnalysisInput, RoundOneAnalysisResult } from './types.js';

const PROVIDER_ORDER: readonly ProviderId[] = ['openai', 'anthropic', 'gemini'];

const NEGATION_PREFIXES = [
  'not ',
  'no ',
  'never ',
  'cannot ',
  'can t ',
  'dont ',
  'don t ',
  'do not ',
  'should not ',
  'unable to ',
  'without ',
];

export function analyzeRoundOneResponses(
  results: readonly RoundOneAnalysisInput[],
): RoundOneAnalysisResult {
  const successResults = results.filter((result) => result.success && result.responseText.trim().length > 0);

  if (successResults.length === 0) {
    return emptyAnalysis();
  }

  const statementsByProvider = new Map<ProviderId, StatementRecord[]>();
  for (const result of successResults) {
    statementsByProvider.set(result.provider, extractStatements(result.responseText));
  }

  const agreementMap = new Map<string, AgreementBucket>();
  const disagreementMap = new Map<string, DisagreementBucket>();
  const verificationMap = new Map<string, DerivedTextFinding>();
  const nextActionMap = new Map<string, DerivedTextFinding>();

  for (const provider of PROVIDER_ORDER) {
    const statements = statementsByProvider.get(provider) ?? [];
    for (const statement of statements) {
      if (looksLikeVerificationItem(statement.original)) {
        verificationMap.set(statement.key, toFinding(statement.original, provider, verificationMap.get(statement.key)));
      }

      if (looksLikeNextAction(statement.original)) {
        nextActionMap.set(statement.key, toFinding(statement.original, provider, nextActionMap.get(statement.key)));
      }

      const agreementBucket = agreementMap.get(statement.key) ?? {
        source: 'DERIVED' as const,
        text: statement.original,
        providers: [],
      };
      if (!agreementBucket.providers.includes(provider)) {
        agreementBucket.providers.push(provider);
      }
      agreementMap.set(statement.key, agreementBucket);

      const polarityKey = canonicalPolarityKey(statement.original);
      if (polarityKey) {
        const bucket = disagreementMap.get(polarityKey.key) ?? {
          source: 'DERIVED' as const,
          providerTexts: {},
          polarities: {},
        };
        bucket.providerTexts[provider] = statement.original;
        bucket.polarities[provider] = polarityKey.polarity;
        disagreementMap.set(polarityKey.key, bucket);
      }
    }
  }

  const agreements = [...agreementMap.values()]
    .filter((bucket) => bucket.providers.length >= 2)
    .sort((left, right) => left.text.localeCompare(right.text))
    .map((bucket) => ({
      source: bucket.source,
      text: bucket.text,
      providers: bucket.providers.slice().sort(),
    }));

  const disagreements = [...disagreementMap.values()]
    .filter((bucket) => hasOpposingPolarities(bucket.polarities))
    .sort((left, right) => localeCompareObjects(left.providerTexts, right.providerTexts))
    .map((bucket) => ({
      source: bucket.source,
      providerTexts: orderProviderTexts(bucket.providerTexts),
    }));

  const verificationRequiredItems = [...verificationMap.values()]
    .sort((left, right) => left.text.localeCompare(right.text));

  const proposedNextActions = [...nextActionMap.values()]
    .sort((left, right) => left.text.localeCompare(right.text));

  return {
    agreements,
    disagreements,
    verificationRequiredItems,
    proposedNextActions,
    humanDecision: 'pending',
  };
}

export interface DerivedTextFinding {
  source: 'DERIVED';
  text: string;
  providers: ProviderId[];
}

export interface AgreementBucket {
  source: 'DERIVED';
  text: string;
  providers: ProviderId[];
}

export interface DisagreementBucket {
  source: 'DERIVED';
  providerTexts: Partial<Record<ProviderId, string>>;
  polarities: Partial<Record<ProviderId, 'positive' | 'negative'>>;
}

function emptyAnalysis(): RoundOneAnalysisResult {
  return {
    agreements: [],
    disagreements: [],
    verificationRequiredItems: [],
    proposedNextActions: [],
    humanDecision: 'pending',
  };
}

function extractStatements(text: string): StatementRecord[] {
  const statements: StatementRecord[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n+/g)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = normalizeStatement(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    statements.push({ original: stripBullet(trimmed), key: normalized });
  }

  return statements;
}

function normalizeStatement(value: string): string {
  return stripBullet(value)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBullet(value: string): string {
  return value.replace(/^(?:[-*•]|[0-9]+[.)])\s+/, '');
}

function looksLikeVerificationItem(value: string): boolean {
  const normalized = normalizeStatement(value);
  return (
    normalized.includes(' verify ') ||
    normalized.startsWith('verify ') ||
    normalized.startsWith('needs verification ') ||
    normalized.startsWith('requires verification ') ||
    normalized.includes(' uncertain ') ||
    normalized.includes(' unknown ') ||
    normalized.includes(' unclear ') ||
    normalized.includes(' pending ')
  );
}

function looksLikeNextAction(value: string): boolean {
  const normalized = normalizeStatement(value);
  return (
    normalized.startsWith('next action ') ||
    normalized.startsWith('next step ') ||
    normalized.startsWith('should ') ||
    normalized.startsWith('propose ') ||
    normalized.startsWith('recommend ') ||
    normalized.includes(' next action ') ||
    normalized.includes(' action item ')
  );
}

function canonicalPolarityKey(value: string): { key: string; polarity: 'positive' | 'negative' } | null {
  const normalized = normalizeStatement(value);
  for (const prefix of NEGATION_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return {
        key: normalized.slice(prefix.length).trim(),
        polarity: 'negative',
      };
    }
  }

  if (normalized.length === 0) {
    return null;
  }

  return {
    key: normalized,
    polarity: 'positive',
  };
}

function hasOpposingPolarities(polarities: Partial<Record<ProviderId, 'positive' | 'negative'>>): boolean {
  const values = Object.values(polarities);
  return values.includes('positive') && values.includes('negative');
}

function orderProviderTexts(providerTexts: Partial<Record<ProviderId, string>>): Partial<Record<ProviderId, string>> {
  const ordered: Partial<Record<ProviderId, string>> = {};
  for (const provider of PROVIDER_ORDER) {
    const value = providerTexts[provider];
    if (typeof value === 'string') {
      ordered[provider] = value;
    }
  }
  return ordered;
}

function localeCompareObjects(left: Partial<Record<ProviderId, string>>, right: Partial<Record<ProviderId, string>>): number {
  return JSON.stringify(orderProviderTexts(left)).localeCompare(JSON.stringify(orderProviderTexts(right)));
}

function toFinding(text: string, provider: ProviderId, existing: DerivedTextFinding | undefined): DerivedTextFinding {
  if (!existing) {
    return {
      source: 'DERIVED',
      text,
      providers: [provider],
    };
  }

  if (!existing.providers.includes(provider)) {
    existing.providers.push(provider);
  }

  return existing;
}

interface StatementRecord {
  original: string;
  key: string;
}
