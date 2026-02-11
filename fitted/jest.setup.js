import '@testing-library/jest-dom';

import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => '/history',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/firebaseClient', () => ({
  auth: {
    currentUser: null,
  },
}));

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn((auth, callback) => {
    setTimeout(() => {
      callback({
        uid: 'test-user-123',
        getIdToken: jest.fn().mockResolvedValue('mock-token'),
      });
    }, 0);
    return jest.fn(); // unsubscribe function
  }),
}));

// Mock fetch globally
global.fetch = jest.fn();

const originalConsoleError = console.error;
console.error = (...args) => {
  if (args[0]?.includes?.('not wrapped in act')) {
    return;
  }
  originalConsoleError(...args);
};

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
