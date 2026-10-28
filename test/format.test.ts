import { describe, expect, it } from 'vitest';
import { escapeMarkdown, issueBody, neutralizeMentions, parseLabels, truncate } from '../src/lib/format';
import { canManageGuild, canTriage } from '../src/lib/permissions';
import { allowedContentType } from '../src/services/attachments';
import type { GuildRow } from '../src/types';

describe('neutralizeMentions', () => {
  it('breaks @user and @org/team mentions', () => {
    expect(neutralizeMentions('ping @octocat and @github/security')).toBe(
      'ping @​octocat and @​github/security'
    );
    expect(neutralizeMentions('@start of line')).toBe('@​start of line');
  });

  it('leaves emails and code spans alone', () => {
    expect(neutralizeMentions('mail me@example.com')).toBe('mail me@example.com');
    expect(neutralizeMentions('use `@decorator`')).toBe('use `@decorator`');
  });
});

describe('issueBody', () => {
  const report = {
    id: 7,
    description: 'It crashed, cc @maintainer',
    steps: '1. open\n2. click',
    environment: null,
    source_url: 'https://discord.com/channels/1/2/3',
    reporter_name: 'reporter',
  };

  it('renders sections, attachments and footer', () => {
    const body = issueBody(
      report,
      [
        { name: 'shot.png', url: 'https://x.dev/files/a.png', content_type: 'image/png' },
        { name: 'app.log', url: 'https://x.dev/files/app.log', content_type: 'text/plain' },
      ],
      'https://x.dev'
    );

    expect(body).toContain('### Description\n\nIt crashed, cc @​maintainer');
    expect(body).toContain('### Steps to reproduce\n\n1. open\n2. click');
    expect(body).not.toContain('### Environment');
    expect(body).toContain('![shot.png](https://x.dev/files/a.png)');
    expect(body).toContain('- [app.log](https://x.dev/files/app.log)');
    expect(body).toContain('[Original message](https://discord.com/channels/1/2/3)');
    expect(body).toContain('<!-- dispatch:report:7 -->');
  });

  it('stays within GitHub limits', () => {
    const body = issueBody({ ...report, description: 'x'.repeat(100_000) }, [], 'https://x.dev');
    expect(body.length).toBeLessThanOrEqual(65_000);
  });
});

describe('helpers', () => {
  it('truncates with an ellipsis', () => {
    expect(truncate('hello world', 6)).toBe('hello…');
    expect(truncate('short', 10)).toBe('short');
  });

  it('parses and dedupes labels', () => {
    expect(parseLabels(' bug, ui ,bug,, ')).toEqual(['bug', 'ui']);
    expect(parseLabels('')).toEqual([]);
  });

  it('escapes Discord markdown', () => {
    expect(escapeMarkdown('**bold** [x](y)')).toBe('\\*\\*bold\\*\\* \\[x\\]\\(y\\)');
  });

  it('only allows safe attachment types', () => {
    expect(allowedContentType('Screenshot.PNG')).toBe('image/png');
    expect(allowedContentType('crash.log')).toBe('text/plain');
    expect(allowedContentType('evil.html')).toBeNull();
    expect(allowedContentType('icon.svg')).toBeNull();
    expect(allowedContentType('noext')).toBeNull();
  });
});

describe('permissions', () => {
  const member = (permissions: bigint, roles: string[] = []) =>
    ({ permissions: permissions.toString(), roles, user: { id: '1', username: 'u' } }) as never;
  const guild = { staff_role_id: 'staff' } as GuildRow;

  it('recognises Manage Server and Administrator', () => {
    expect(canManageGuild(member(1n << 5n))).toBe(true);
    expect(canManageGuild(member(1n << 3n))).toBe(true);
    expect(canManageGuild(member(1n << 11n))).toBe(false);
  });

  it('lets the staff role triage', () => {
    expect(canTriage(member(0n, ['staff']), guild)).toBe(true);
    expect(canTriage(member(0n, ['other']), guild)).toBe(false);
    expect(canTriage(member(0n, ['staff']), { ...guild, staff_role_id: null })).toBe(false);
  });
});
