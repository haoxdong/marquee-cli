// Marquee Web's View Errors shows a runner error as it comes, which can span lines (live,
// 2026-11-04: `context: None: POST …/v1/data/measures` then `status: 502, …`); one error is one line.
const LINE_BREAK = /\s*\n\s*/g;

// An asset with no dataset for the measure called on it, by its Marquee id and as written (live,
// 2026-10-16): `Markets endpoint: <uuid> DataSet not found for entity with id: MA… ,USGGBE10)`.
const NO_DATASET = /Markets endpoint: \S+ DataSet not found for entity with id: (\S+) ,([^)]+)\)/;

/** The asset a "DataSet not found" message names: its Marquee id and its identifier as written. */
export function assetWithoutDataset(message: string): Readonly<{ assetId: string; identifier: string }> | undefined {
  const found = NO_DATASET.exec(message);
  return found?.[1] === undefined || found[2] === undefined ? undefined : { assetId: found[1], identifier: found[2] };
}

/** A runner Expression error exactly as Marquee sends it, on one line. */
export function oneLineMessage(message: string): string {
  return message.replace(LINE_BREAK, ' ');
}
