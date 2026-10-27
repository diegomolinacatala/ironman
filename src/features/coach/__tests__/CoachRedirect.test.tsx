import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';

import CoachScreen from '@/app/coach';

const mockParams: { value: Record<string, string> } = { value: {} };
const mockRedirect = jest.fn((_props: { href: string }) => null);

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams.value,
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

beforeEach(() => {
  mockRedirect.mockClear();
});

describe('/coach (v1 links)', () => {
  test('redirects to the voice coach', async () => {
    mockParams.value = {};
    await render(<CoachScreen />);
    expect(mockRedirect).toHaveBeenLastCalledWith({ href: '/talk' });
  });

  test('forwards message and replan params as a prefill', async () => {
    mockParams.value = { mode: 'replan', lifeEventId: 'e1', message: 'Me duele' };
    await render(<CoachScreen />);
    expect(mockRedirect).toHaveBeenLastCalledWith({ href: '/talk?mode=replan&lifeEventId=e1&message=Me%20duele' });
  });
});
