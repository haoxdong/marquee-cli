type MarketViewWriter = (text: string) => void;
export interface MarketViewPresentationSink {
  write: MarketViewWriter;
  writeError: MarketViewWriter;
  setExitCode(exitCode: number): void;
}
/** A MarketView command failure: its stderr text and classified exit code (ADR 0070). */
export type MarketViewErrorPresentation = Readonly<{
  message: string;
  exitCode: 1 | 2 | 4;
}>;
