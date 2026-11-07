import { describe, expect, it } from 'vitest';
import { allOk, type Result } from '../result.js';

const never = new Promise<Result<number, string>>(() => undefined);

describe('allOk', () => {
  it('gives every value in order once all succeed', async () => {
    const later = new Promise<Result<number, string>>((resolve) => setTimeout(() => resolve({ ok: true, value: 1 }), 5));
    await expect(allOk([later, Promise.resolve({ ok: true, value: 2 })])).resolves.toEqual({ ok: true, value: [1, 2] });
  });

  it('gives an empty list for no results', async () => {
    await expect(allOk([])).resolves.toEqual({ ok: true, value: [] });
  });

  it('rejects with a sibling that throws', async () => {
    await expect(allOk([never, Promise.reject(new Error('defect'))])).rejects.toThrow('defect');
  });
});
