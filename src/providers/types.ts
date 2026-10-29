import type { Bindings, GuildRepo, Provider } from '../types';

export type IssueInput = {
  title: string;
  body: string;
  labels: string[];
};

export type CreatedIssue = {
  number: number;
  url: string;
};

/**
 * Everything Dispatch needs from a code host. GitHub is the only
 * implementation today; GitLab / Bitbucket slot in by implementing this and
 * registering in `providers/index.ts`. Linking (OAuth) and inbound webhooks
 * are provider specific and live alongside each implementation.
 */
export interface IssueProvider {
  readonly id: Provider;
  readonly name: string;
  repoUrl(fullName: string): string;
  createIssue(env: Bindings, repo: GuildRepo, input: IssueInput): Promise<CreatedIssue>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
