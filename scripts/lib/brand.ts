import pc from "picocolors";

// The VOSS mark: heavy wordmark plus an orange square. Same lockup as the site,
// the login page and the email — one identity, drawn three ways.
const ORANGE = (s: string) => `\x1b[38;2;251;122;60m${s}\x1b[0m`;

export const voss = () => `${pc.bold("VOSS")}${ORANGE("■")}`;
export const accent = ORANGE;

export function banner(subtitle: string) {
  return `\n  ${voss()}  ${pc.dim(subtitle)}\n`;
}

/** Secrets are hashed at rest, so this is the only moment the plaintext exists. */
export function secretBox(lines: [string, string][]) {
  const width = Math.max(...lines.map(([k]) => k.length));
  return lines
    .map(([k, v]) => `  ${pc.dim(k.padEnd(width))}  ${pc.bold(v)}`)
    .join("\n");
}
