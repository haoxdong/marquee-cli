/** A value, or the typed reason there is none. */
export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

type Value<R> = R extends Readonly<{ ok: true; value: infer T }> ? T : never;
type Failure<R> = R extends Readonly<{ ok: false; error: infer E }> ? E : never;

/**
 * Every result's value in order, or the first failure as soon as it arrives, without
 * waiting for the rest (ADR 0030's fan-out rule).
 */
export function allOk<P extends readonly Promise<Result<unknown, unknown>>[] | []>(
  results: P,
): Promise<Result<{ -readonly [K in keyof P]: Value<Awaited<P[K]>> }, Failure<Awaited<P[number]>>>> {
  type All = Awaited<ReturnType<typeof allOk<P>>>;
  return new Promise<All>((resolve, reject) => {
    const values: unknown[] = [];
    let pending = results.length;
    if (pending === 0) resolve({ ok: true, value: values } as All);
    results.forEach((result, index) => {
      result.then((settled) => {
        if (!settled.ok) {
          resolve(settled as All);
          return;
        }
        values[index] = settled.value;
        pending -= 1;
        if (pending === 0) resolve({ ok: true, value: values } as All);
      }, reject);
    });
  });
}
