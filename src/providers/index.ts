import type { Provider } from '../types';
import { github } from './github';
import type { IssueProvider } from './types';

const providers: Record<Provider, IssueProvider> = {
  github,
};

export function getProvider(id: Provider): IssueProvider {
  return providers[id];
}

export { ProviderError } from './types';
export type { CreatedIssue, IssueInput, IssueProvider } from './types';
