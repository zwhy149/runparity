import { stripVTControlCharacters } from "node:util";

const REDACTED = "[REDACTED]";
const SENSITIVE_OUTPUT_REDACTED = "[REDACTED_SENSITIVE_OUTPUT]";
const MIN_LITERAL_SECRET_BYTES = 12;

const secretPatterns: ReadonlyArray<RegExp> = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g,
];

const bearerAuthorization = /(\bAuthorization\s*:\s*Bearer\s+)([^\s"']+)/gi;

const sensitiveFlag =
  /^((?:--|\/)(?:[a-z0-9]+[-_])*(?:token|secret|password|passwd|credential|api[-_]?key|private[-_]?key|secret[-_]?key))(?:(=|:)(.*))?$/i;

const inlineSensitiveFlag =
  /((?:--|\/)(?:[a-z0-9]+[-_])*(?:token|secret|password|passwd|credential|api[-_]?key|private[-_]?key|secret[-_]?key)(?:=|:))([^\s"'`|,;]+)/gi;

function stripTerminalControls(value: string): string {
  const withoutTerminalSequences = stripVTControlCharacters(
    value.replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/gu, "\n"),
  );
  let sanitized = "";
  for (const character of withoutTerminalSequences) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = codePoint === 9 || codePoint === 10;
    const isUnsafeControl = codePoint < 32 || (codePoint >= 127 && codePoint <= 159);
    const isBidiFormatting =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069);
    const isInvisibleSeparator =
      codePoint === 0x200b || codePoint === 0x2060 || codePoint === 0xfeff;
    const isDefaultIgnorableSpoofingControl =
      codePoint === 0x00ad ||
      codePoint === 0x034f ||
      codePoint === 0x180e ||
      (codePoint >= 0x206a && codePoint <= 0x206f) ||
      (codePoint >= 0xfff9 && codePoint <= 0xfffb) ||
      codePoint === 0xe0001 ||
      (codePoint >= 0xe0020 && codePoint <= 0xe007f);
    if (
      (isAllowedWhitespace || !isUnsafeControl) &&
      !isBidiFormatting &&
      !isInvisibleSeparator &&
      !isDefaultIgnorableSpoofingControl
    ) {
      sanitized += character;
    }
  }
  return sanitized;
}

function redactKnownPatterns(value: string): string {
  let redacted = stripTerminalControls(value)
    .replace(bearerAuthorization, `$1${REDACTED}`)
    .replace(inlineSensitiveFlag, `$1${REDACTED}`);
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

export type RedactionContext = {
  redactText(value: string): string;
  redactScalar(value: string): string;
  redactArgv(argv: readonly string[]): string[];
  redactExcerpt(value: Buffer, truncated: boolean, maxBytes: number): string;
  sanitizeStructuredDisplay<T>(value: T): T;
  learnSensitiveEnvironment(environment: Readonly<NodeJS.ProcessEnv>): void;
};

const BOUNDARY_REDACTED = "[REDACTED_BOUNDARY]";

function limitUtf8Tail(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  return bytes.length <= maxBytes
    ? value
    : bytes.subarray(bytes.length - maxBytes).toString("utf8");
}

function limitUtf8TailAtLineBoundary(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;
  const tail = bytes.subarray(bytes.length - maxBytes).toString("utf8");
  const firstLineBreak = tail.indexOf("\n");
  return firstLineBreak === -1 ? "" : tail.slice(firstLineBreak);
}

export function createRedactionContext(argv: readonly string[]): RedactionContext {
  const sanitizedArgv = argv.map(stripTerminalControls);
  const secrets = new Set<string>();
  for (let index = 0; index < sanitizedArgv.length; index += 1) {
    const argument = sanitizedArgv[index] ?? "";
    const match = argument.match(sensitiveFlag);
    if (match === null) continue;
    if (match[3] !== undefined) {
      if (match[3].length > 0) secrets.add(match[3]);
      continue;
    }
    const nextArgument = sanitizedArgv[index + 1];
    if (nextArgument !== undefined && nextArgument.length > 0) {
      secrets.add(nextArgument);
    }
  }
  let learnedSecrets: string[] = [];
  let literalSecrets: string[] = [];
  let hasShortSecret = false;
  let hasMultilineSecret = false;
  const refreshLearnedSecrets = (): void => {
    learnedSecrets = [...secrets].sort((left, right) => right.length - left.length);
    literalSecrets = learnedSecrets;
    hasShortSecret = learnedSecrets.some(
      (secret) => Buffer.byteLength(secret) < MIN_LITERAL_SECRET_BYTES,
    );
    hasMultilineSecret = learnedSecrets.some((secret) => secret.includes("\n"));
  };
  refreshLearnedSecrets();

  const learnSensitiveEnvironment = (environment: Readonly<NodeJS.ProcessEnv>): void => {
    for (const [name, value] of Object.entries(environment)) {
      if (
        value !== undefined &&
        /(?:^|[_-])(?:token|secret|password|passwd|credential|key)$/iu.test(name)
      ) {
        const sanitizedValue = stripTerminalControls(value);
        if (sanitizedValue.length > 0) secrets.add(sanitizedValue);
      }
    }
    refreshLearnedSecrets();
  };

  const redactWithContext = (value: string): string => {
    let redacted = redactKnownPatterns(value);
    for (const secret of literalSecrets) {
      redacted = redacted.replaceAll(secret, REDACTED);
    }
    return redacted;
  };

  const redactArgvWithContext = (values: readonly string[]): string[] => {
    const result: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const rawValue = values[index] ?? "";
      const value = stripTerminalControls(rawValue);
      const match = value.match(sensitiveFlag);
      if (match !== null) {
        if (match[3] !== undefined) {
          result.push(`${match[1]}${match[2]}${REDACTED}`);
        } else {
          result.push(redactWithContext(value));
          const nextValue = values[index + 1];
          if (
            nextValue !== undefined &&
            stripTerminalControls(nextValue).match(sensitiveFlag) === null
          ) {
            result.push(REDACTED);
            index += 1;
          }
        }
        continue;
      }
      result.push(redactWithContext(value));
    }
    return result;
  };

  const redactExcerptWithContext = (
    value: Buffer,
    truncated: boolean,
    maxBytes: number,
  ): string => {
    if (value.length === 0) return "";
    if (hasShortSecret) {
      return truncated ? BOUNDARY_REDACTED : SENSITIVE_OUTPUT_REDACTED;
    }
    if (truncated && hasMultilineSecret) return BOUNDARY_REDACTED;
    if (!truncated) return limitUtf8Tail(redactWithContext(value.toString("utf8")), maxBytes);

    const withBoundaryMarker = (remainder: string): string => {
      const markerBytes = Buffer.byteLength(BOUNDARY_REDACTED);
      return `${BOUNDARY_REDACTED}${limitUtf8TailAtLineBoundary(
        remainder,
        Math.max(0, maxBytes - markerBytes),
      )}`;
    };
    const decoded = value.toString("utf8");
    const firstLineBreak = decoded.search(/[\r\n\u2028\u2029]/u);
    const completeLines = firstLineBreak === -1 ? "" : decoded.slice(firstLineBreak);
    return withBoundaryMarker(redactWithContext(completeLines));
  };

  const redactScalarWithContext = (value: string): string =>
    redactWithContext(value).replaceAll("\t", "\\t").replaceAll("\n", "\\n");

  const sanitizeStructuredDisplay = <T>(value: T): T => {
    if (typeof value === "string") return stripTerminalControls(value) as T;
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeStructuredDisplay(item)) as T;
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, sanitizeStructuredDisplay(item)]),
      ) as T;
    }
    return value;
  };

  return {
    redactText: redactWithContext,
    redactScalar: redactScalarWithContext,
    redactArgv: redactArgvWithContext,
    redactExcerpt: redactExcerptWithContext,
    sanitizeStructuredDisplay,
    learnSensitiveEnvironment,
  };
}

const defaultContext = createRedactionContext([]);

export const redactText = defaultContext.redactText;
export const redactScalar = defaultContext.redactScalar;
export const redactArgv = defaultContext.redactArgv;
