import { describe, expect, jest, test } from '@jest/globals';
import { Linking } from 'react-native';

import { CLAUDE_STARTER_PROMPT, claudeChatUrl, openClaudeChat } from '../claudeLink';

describe('claudeLink', () => {
  test('builds a new-chat link with the prompt prefilled and encoded', () => {
    expect(claudeChatUrl('hola & adiós')).toBe('https://claude.ai/new?q=hola%20%26%20adi%C3%B3s');
    expect(claudeChatUrl()).toContain(encodeURIComponent(CLAUDE_STARTER_PROMPT));
  });

  test('opens the link and never throws when it cannot', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no handler'));
    await expect(openClaudeChat('x')).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('https://claude.ai/new?q=x');
    await expect(openClaudeChat()).resolves.toBe(false);
    open.mockRestore();
  });
});
