/** Okapi BM25 parameters. */
const K1 = 1.2;
const B = 0.75;

/** Lowercase runs of letters, digits, and underscores, so identifiers stay one token. */
const TOKEN = /[a-z0-9_]+/g;

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "might",
  "more",
  "most",
  "must",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "out",
  "over",
  "own",
  "same",
  "shall",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "then",
  "there",
  "these",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
]);

export interface Bm25Document {
  id: string;
  body: string;
}

export interface Bm25Index {
  n: number;
  avgLength: number;
  lengthById: Map<string, number>;
  tfById: Map<string, Map<string, number>>;
  df: Map<string, number>;
}

function tokensIn(text: string): string[] {
  const found = text.toLowerCase().match(TOKEN) ?? [];
  return found.filter((token) => !STOPWORDS.has(token));
}

/**
 * Term frequencies for every document. Built once per Corpus identity and
 * reused until the set of Chunk ids changes.
 */
export function buildBm25Index(documents: Bm25Document[]): Bm25Index {
  const lengthById = new Map<string, number>();
  const tfById = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  let tokens = 0;

  for (const document of documents) {
    const terms = tokensIn(document.body);
    lengthById.set(document.id, terms.length);
    tokens += terms.length;

    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    tfById.set(document.id, tf);

    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const n = documents.length;
  return {
    n,
    avgLength: n === 0 ? 1 : Math.max(tokens / n, 1),
    lengthById,
    tfById,
    df,
  };
}

function idf(index: Bm25Index, term: string): number {
  const df = index.df.get(term) ?? 0;
  return Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
}

function scoreDocument(index: Bm25Index, id: string, queryTerms: string[]): number {
  const tf = index.tfById.get(id);
  if (!tf) {
    return 0;
  }
  const length = index.lengthById.get(id) ?? 0;
  let score = 0;
  for (const term of queryTerms) {
    const freq = tf.get(term) ?? 0;
    if (freq === 0) {
      continue;
    }
    const denom = freq + K1 * (1 - B + (B * length) / index.avgLength);
    score += (idf(index, term) * (freq * (K1 + 1))) / denom;
  }
  return score;
}

/**
 * 1-based ranks for documents whose BM25 score is above zero. A question that
 * tokenizes to nothing but stopwords yields an empty map — the lexical list
 * that Reciprocal Rank Fusion then treats as missing.
 */
export function bm25Ranks(index: Bm25Index, question: string): Map<string, number> {
  const queryTerms = tokensIn(question);
  if (queryTerms.length === 0) {
    return new Map();
  }

  const scored: Array<{ id: string; score: number }> = [];
  for (const id of index.tfById.keys()) {
    const score = scoreDocument(index, id, queryTerms);
    if (score > 0) {
      scored.push({ id, score });
    }
  }
  scored.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  const ranks = new Map<string, number>();
  for (const [offset, { id }] of scored.entries()) {
    ranks.set(id, offset + 1);
  }
  return ranks;
}

let cache: { key: string; index: Bm25Index } | null = null;

function cacheKey(documents: Bm25Document[]): string {
  return documents
    .map((document) => document.id)
    .sort()
    .join("\0");
}

/** Returns a BM25 index for these documents, rebuilding only when the id set changes. */
export function bm25IndexFor(documents: Bm25Document[]): Bm25Index {
  const key = cacheKey(documents);
  if (cache !== null && cache.key === key) {
    return cache.index;
  }
  const index = buildBm25Index(documents);
  cache = { key, index };
  return index;
}
