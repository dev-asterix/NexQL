export interface CompletionCandidate {
  label: string;
  insertText: string;
  detail?: string;
  sortText?: string;
  score?: number;
  kind?: 'table' | 'column' | 'value' | 'join';
}

export interface CompletionCandidateContext {
  connectionId: string;
  database: string;
  sqlBeforeCursor: string;
  partialWord: string;
  explicit?: boolean;
}

export interface CompletionCandidateSource {
  getCandidates(context: CompletionCandidateContext): Promise<CompletionCandidate[]>;
}

let registeredSource: CompletionCandidateSource | null = null;

export function registerCompletionCandidateSource(source: CompletionCandidateSource | null): void {
  registeredSource = source;
}

export function getCompletionCandidateSource(): CompletionCandidateSource | null {
  return registeredSource;
}
