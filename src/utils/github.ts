export function parseGitHubRepo(input: string): string | null {
  if (!input) return null;

  let cleaned = input.trim().replace(/\.git$/, '').replace(/\/$/, '');

  if (cleaned.includes('github.com/')) {
    const parts = cleaned.split('github.com/')[1]?.split('/');
    if (parts && parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
  }

  const directParts = cleaned.split('/');
  if (directParts.length === 2 && directParts[0] && directParts[1]) {
    return `${directParts[0]}/${directParts[1]}`;
  }

  return null;
}