import { expect, test } from 'vitest';
import { SERVICE_NAME } from '../../src/index.js';

test('exports its stable service name', () => {
  expect(SERVICE_NAME).toBe('getcourse-ai-homework-checker');
});
