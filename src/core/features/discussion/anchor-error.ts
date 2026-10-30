export class DescriptionAnchorError extends Error {
  readonly code: string;
  constructor(readonly status: 400 | 409, message: string, source: 'description' | 'document' = 'description') {
    super(message);
    this.code = status === 409 ? `stale_${source}` : 'invalid_anchor';
  }
}
