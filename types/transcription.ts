export type LiveTranscriptionTokenRequest = {
  languageCode?: string;
  adaptationPhrases?: string[];
};

export type LiveTranscriptionTokenResponse = {
  token: string;
  model: string;
  expiresAt: string;
};

export type TranscriptionError = {
  error: string;
  details?: string;
};
