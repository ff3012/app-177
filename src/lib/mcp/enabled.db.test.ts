import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled, setMcpEnabled } from './enabled';

let original: boolean;

beforeAll(async () => {
  original = await isMcpEnabled();
});

afterAll(async () => {
  await setMcpEnabled(original);
  await prisma.$disconnect();
});

describe('mcpEnabled', () => {
  it('lässt sich ein- und ausschalten', async () => {
    await setMcpEnabled(true);
    expect(await isMcpEnabled()).toBe(true);
    await setMcpEnabled(false);
    expect(await isMcpEnabled()).toBe(false);
  });
});
