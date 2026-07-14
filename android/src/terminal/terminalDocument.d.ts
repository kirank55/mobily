export interface TerminalDocumentAssets {
  readonly xtermCss: string;
  readonly xtermJs: string;
  readonly xtermFitJs: string;
  readonly devBridgeJs?: string;
}

export function buildTerminalDocument(assets: TerminalDocumentAssets): string;
