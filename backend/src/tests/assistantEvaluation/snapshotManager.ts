import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import type { AnswerSelectionId } from "../../assistant/responseCatalog.js";
import { FAQ_HASH, FAQ_VERSION, PROMPT_HASH, PROMPT_VERSION } from "../../assistant/knowledgeBundle.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const defaultReferenceCatalogPath = path.join(currentDir, "fixtures/pos24-reference-catalog.json");
const defaultBaselineCatalogPath = path.join(currentDir, "fixtures/pos24-baseline-response-catalog.txt");
const defaultBaselineSnapshotPath = path.resolve(currentDir, "../../../../documents/06-security-ai/prompt-archive/pos23-baseline-snapshot.json");
const defaultCatalogPath = path.resolve(currentDir, "../../assistant/responseCatalog.ts");
export const LOCKED_BASELINE_SHA256 = "8f119ce37e0db97816dad987cf231115db90b492d359f6e7bef53a0c61c0c74d";

export const RUNTIME_SNAPSHOT_SCHEMA_VERSION = "assistant-runtime-snapshot-v1";

export type SnapshotRole = "control" | "candidate" | "rollback_target";

export type SnapshotCatalogEntry = {
  id: AnswerSelectionId;
  selectionHint: string;
  answer: string;
  answerHash: string;
};

export type RuntimeSnapshot = {
  snapshotVersion: string;
  createdAt: string;
  snapshotRole: SnapshotRole;
  gitHead: string;
  workingTreeStatus: "WIP" | "CLEAN";
  workingTreeEntriesCount: number;
  targetRelativePath: string;
  runtimeFileSha256: string;
  sourceContent: string;
  selectorPromptHash: string;
  answerCatalogHash: string;
  catalogVersion: string;
  faqVersion: string;
  faqHash: string;
  entries: readonly SnapshotCatalogEntry[];
};

export type SnapshotVerificationResult = {
  valid: boolean;
  issues: string[];
  entriesCount: number;
  runtimeFileSha256: string;
  selectorPromptHash: string;
  answerCatalogHash: string;
};

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const HASH_REGEX = /^[0-9a-f]{64}$/;

export type ParsedCatalogSeedItem = {
  id: string;
  sourceFaqIds: string[];
  selectionHint: string;
  answer: string;
  sourceNote: string;
};

export type ParsedCatalogAst = {
  seedEntries: ParsedCatalogSeedItem[];
  selectorPrompt: string;
  catalogVersion: string;
  protocolVersion: string;
};

function unwrapAstExpression(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Parses responseCatalog.ts source code via TypeScript AST without executing any code.
 * Fails closed on unsupported syntax, computed properties, dynamic calls, structural divergence, or missing structures.
 */
export function parseResponseCatalogAst(sourceText: string): ParsedCatalogAst {
  const sourceFile = ts.createSourceFile("responseCatalog.ts", sourceText, ts.ScriptTarget.Latest, true);

  const parseDiagnostics = (sourceFile as any).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    const firstDiag = parseDiagnostics[0];
    const msg = typeof firstDiag.messageText === "string" ? firstDiag.messageText : firstDiag.messageText?.messageText ?? "parse failure";
    throw new Error(`TypeScript syntax error: ${msg}`);
  }

  const declaredNames = new Set<string>();
  const allowedImports = ["node:crypto", "./knowledgeBundle.js"];

  let catalogSeedNode: ts.ArrayLiteralExpression | null = null;
  let selectorPromptNode: ts.Node | null = null;
  let catalogVersionValue: string | null = null;
  let selectorProtocolVersionValue: string | null = null;
  let answerCatalogHashDecl: ts.VariableDeclaration | null = null;
  let promptHashDecl: ts.VariableDeclaration | null = null;
  let sha256FnDecl: ts.FunctionDeclaration | null = null;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier) || !allowedImports.includes(statement.moduleSpecifier.text)) {
        throw new Error(`Unexpected import from "${statement.moduleSpecifier.getText(sourceFile)}" in responseCatalog.`);
      }
      const importClause = statement.importClause;
      if (!importClause || !importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
        throw new Error(`Import from "${statement.moduleSpecifier.text}" must use named imports.`);
      }
      const allowedBindingsForModule: Record<string, string[]> = {
        "node:crypto": ["createHash"],
        "./knowledgeBundle.js": ["FAQ_HASH", "FAQ_ITEM_IDS", "FAQ_VERSION", "PROMPT_HASH", "PROMPT_VERSION"],
      };
      const allowedBindings = allowedBindingsForModule[statement.moduleSpecifier.text] ?? [];
      for (const element of importClause.namedBindings.elements) {
        const importedName = element.name.text;
        if (!allowedBindings.includes(importedName)) {
          throw new Error(`Unexpected imported identifier "${importedName}" from "${statement.moduleSpecifier.text}".`);
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        const name = decl.name.getText(sourceFile);
        if (declaredNames.has(name)) {
          throw new Error(`Duplicate top-level declaration: "${name}".`);
        }
        declaredNames.add(name);

        if (!decl.initializer) {
          throw new Error(`Declaration "${name}" must have an initializer.`);
        }
        const unwrapped = unwrapAstExpression(decl.initializer);

        if (name === "CATALOG_SEED") {
          if (ts.isArrayLiteralExpression(unwrapped)) {
            catalogSeedNode = unwrapped;
          } else {
            throw new Error("CATALOG_SEED must be initialized with an array literal.");
          }
        } else if (name === "ASSISTANT_SELECTOR_PROMPT") {
          selectorPromptNode = unwrapped;
        } else if (name === "ANSWER_CATALOG_VERSION") {
          if (ts.isStringLiteral(unwrapped)) {
            catalogVersionValue = unwrapped.text;
          } else {
            throw new Error("ANSWER_CATALOG_VERSION must be initialized with a string literal.");
          }
        } else if (name === "SELECTOR_PROTOCOL_VERSION") {
          if (ts.isStringLiteral(unwrapped)) {
            selectorProtocolVersionValue = unwrapped.text;
          } else {
            throw new Error("SELECTOR_PROTOCOL_VERSION must be initialized with a string literal.");
          }
        } else if (name === "ANSWER_CATALOG_HASH") {
          answerCatalogHashDecl = decl;
        } else if (name === "ASSISTANT_SELECTOR_PROMPT_HASH") {
          promptHashDecl = decl;
        } else if (name === "ANSWER_CATALOG") {
          if (!ts.isCallExpression(unwrapped)) {
            throw new Error("ANSWER_CATALOG must call Object.freeze(CATALOG_SEED.map(...)).");
          }
          const callTarget = unwrapped.expression;
          if (!ts.isPropertyAccessExpression(callTarget) || callTarget.expression.getText(sourceFile) !== "Object" || callTarget.name.text !== "freeze") {
            throw new Error("ANSWER_CATALOG must call Object.freeze.");
          }
        } else if (name === "ASSISTANT_SELECTOR_CONTEXT") {
          if (!ts.isCallExpression(unwrapped)) {
            throw new Error("ASSISTANT_SELECTOR_CONTEXT must call JSON.stringify(...).");
          }
          const callTarget = unwrapped.expression;
          if (!ts.isPropertyAccessExpression(callTarget) || callTarget.expression.getText(sourceFile) !== "JSON" || callTarget.name.text !== "stringify") {
            throw new Error("ASSISTANT_SELECTOR_CONTEXT must call JSON.stringify.");
          }
        } else if (name === "ANSWER_CATALOG_BY_ID") {
          if (!ts.isNewExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression) || unwrapped.expression.text !== "Map") {
            throw new Error("ANSWER_CATALOG_BY_ID must be initialized with new Map(...).");
          }
        }
      }
    } else if (ts.isTypeAliasDeclaration(statement)) {
      const name = statement.name.getText(sourceFile);
      if (declaredNames.has(name)) {
        throw new Error(`Duplicate top-level declaration: "${name}".`);
      }
      declaredNames.add(name);
    } else if (ts.isFunctionDeclaration(statement)) {
      if (statement.name) {
        const name = statement.name.getText(sourceFile);
        if (declaredNames.has(name)) {
          throw new Error(`Duplicate top-level declaration: "${name}".`);
        }
        declaredNames.add(name);
        if (name === "sha256") {
          sha256FnDecl = statement;
        }
      } else {
        throw new Error("Anonymous top-level functions are not permitted.");
      }
    } else {
      throw new Error(`Unexpected top-level statement in responseCatalog: ${ts.SyntaxKind[statement.kind]}.`);
    }
  }

  // Exhaustive structural allowlist: only these exact names are permitted as top-level declarations.
  // Any name not in this set is rejected to prevent injection of arbitrary initializers (e.g. IIFEs).
  const allowedDeclarations = new Set([
    "ANSWER_CATALOG_VERSION",
    "SELECTOR_PROTOCOL_VERSION",
    "CatalogSeed",
    "CATALOG_SEED",
    "AnswerSelectionId",
    "AnswerCatalogEntry",
    "ANSWER_CATALOG",
    "ANSWER_CATALOG_HASH",
    "ASSISTANT_SELECTOR_PROMPT",
    "ASSISTANT_SELECTOR_PROMPT_HASH",
    "ASSISTANT_SELECTOR_CONTEXT",
    "ANSWER_CATALOG_BY_ID",
    "sha256",
    "getAnswerCatalogEntry",
    "isAnswerSelectionId",
    "validateAnswerCatalog",
  ]);

  const requiredDeclarations = [
    "ANSWER_CATALOG_VERSION",
    "SELECTOR_PROTOCOL_VERSION",
    "CATALOG_SEED",
    "ANSWER_CATALOG",
    "ANSWER_CATALOG_HASH",
    "ASSISTANT_SELECTOR_PROMPT",
    "ASSISTANT_SELECTOR_PROMPT_HASH",
    "ASSISTANT_SELECTOR_CONTEXT",
    "sha256",
    "getAnswerCatalogEntry",
    "isAnswerSelectionId",
    "validateAnswerCatalog",
  ];

  // Reject any declaration not in the closed allowlist
  for (const name of declaredNames) {
    if (!allowedDeclarations.has(name)) {
      throw new Error(`Unexpected top-level declaration: "${name}". Only known structural declarations are permitted.`);
    }
  }

  for (const req of requiredDeclarations) {
    if (!declaredNames.has(req)) {
      throw new Error(`Missing required top-level declaration: "${req}".`);
    }
  }

  // Verify sha256 function structural integrity
  if (!sha256FnDecl || !sha256FnDecl.body || sha256FnDecl.body.statements.length !== 1) {
    throw new Error("sha256 function must contain exactly one return statement.");
  }
  const retStmt = sha256FnDecl.body.statements[0];
  if (!ts.isReturnStatement(retStmt) || !retStmt.expression) {
    throw new Error("sha256 function must return an expression.");
  }
  const retExpr = unwrapAstExpression(retStmt.expression);
  if (!ts.isCallExpression(retExpr)) {
    throw new Error("sha256 function must return createHash('sha256').update(value, 'utf8').digest('hex').");
  }
  const digestProp = retExpr.expression;
  if (!ts.isPropertyAccessExpression(digestProp) || digestProp.name.text !== "digest") {
    throw new Error("sha256 function must call .digest('hex').");
  }
  if (retExpr.arguments.length !== 1 || !ts.isStringLiteral(retExpr.arguments[0]) || retExpr.arguments[0].text !== "hex") {
    throw new Error("sha256 .digest() argument must be 'hex'.");
  }
  const updateCall = unwrapAstExpression(digestProp.expression);
  if (!ts.isCallExpression(updateCall)) {
    throw new Error("sha256 function must call .update().");
  }
  const updateProp = updateCall.expression;
  if (!ts.isPropertyAccessExpression(updateProp) || updateProp.name.text !== "update") {
    throw new Error("sha256 function must call .update().");
  }
  // Verify .update() arguments: must be exactly (value, "utf8")
  if (updateCall.arguments.length !== 2) {
    throw new Error("sha256 .update() must receive exactly 2 arguments.");
  }
  const updateArg0 = updateCall.arguments[0];
  if (!ts.isIdentifier(updateArg0) || updateArg0.text !== "value") {
    throw new Error("sha256 .update() first argument must be the identifier 'value', not a computed expression.");
  }
  const updateArg1 = updateCall.arguments[1];
  if (!ts.isStringLiteral(updateArg1) || updateArg1.text !== "utf8") {
    throw new Error("sha256 .update() second argument must be string literal 'utf8'.");
  }
  const createHashCall = unwrapAstExpression(updateProp.expression);
  if (!ts.isCallExpression(createHashCall)) {
    throw new Error("sha256 function must call createHash('sha256').");
  }
  if (!ts.isIdentifier(createHashCall.expression) || createHashCall.expression.text !== "createHash") {
    throw new Error("sha256 function must call createHash.");
  }
  if (
    createHashCall.arguments.length !== 1 ||
    !ts.isStringLiteral(createHashCall.arguments[0]) ||
    createHashCall.arguments[0].text !== "sha256"
  ) {
    throw new Error("sha256 function argument to createHash must be literal 'sha256'.");
  }

  // Verify ANSWER_CATALOG_HASH formula
  if (answerCatalogHashDecl && answerCatalogHashDecl.initializer) {
    const unwrapped = unwrapAstExpression(answerCatalogHashDecl.initializer);
    if (!ts.isCallExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression) || unwrapped.expression.text !== "sha256") {
      throw new Error("ANSWER_CATALOG_HASH must call sha256().");
    }
    if (unwrapped.arguments.length !== 1) {
      throw new Error("ANSWER_CATALOG_HASH sha256() must have 1 argument.");
    }
    const arg = unwrapAstExpression(unwrapped.arguments[0]);
    if (!ts.isCallExpression(arg)) {
      throw new Error("ANSWER_CATALOG_HASH argument must be JSON.stringify().");
    }
    const fn = arg.expression;
    if (!ts.isPropertyAccessExpression(fn) || fn.expression.getText(sourceFile) !== "JSON" || fn.name.text !== "stringify") {
      throw new Error("ANSWER_CATALOG_HASH argument must be JSON.stringify().");
    }
    // Validate the inner structure of JSON.stringify's argument object
    if (arg.arguments.length !== 1) {
      throw new Error("ANSWER_CATALOG_HASH JSON.stringify() must have exactly 1 argument.");
    }
    const jsonArg = unwrapAstExpression(arg.arguments[0]);
    if (!ts.isObjectLiteralExpression(jsonArg)) {
      throw new Error("ANSWER_CATALOG_HASH JSON.stringify() argument must be an object literal.");
    }
    // Fixed structural allowlist for JSON.stringify properties:
    // Each property name maps to the required identifier value.
    const expectedHashFormulaProps: Record<string, string> = {
      version: "ANSWER_CATALOG_VERSION",
      sourceFaqVersion: "FAQ_VERSION",
      sourceFaqHash: "FAQ_HASH",
      sourcePromptVersion: "PROMPT_VERSION",
      sourcePromptHash: "PROMPT_HASH",
    };
    const seenHashProps = new Set<string>();
    for (const prop of jsonArg.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new Error("ANSWER_CATALOG_HASH formula object must only use property assignments.");
      }
      const propName = prop.name.getText(sourceFile);
      seenHashProps.add(propName);
      if (propName in expectedHashFormulaProps) {
        const expectedIdent = expectedHashFormulaProps[propName];
        const propValue = unwrapAstExpression(prop.initializer);
        if (!ts.isIdentifier(propValue) || propValue.text !== expectedIdent) {
          throw new Error(
            `ANSWER_CATALOG_HASH formula property "${propName}" must reference identifier "${expectedIdent}", got "${prop.initializer.getText(sourceFile)}".`,
          );
        }
      } else if (propName === "entries") {
        // entries must be ANSWER_CATALOG.map(...)
        const propValue = unwrapAstExpression(prop.initializer);
        if (!ts.isCallExpression(propValue)) {
          throw new Error("ANSWER_CATALOG_HASH formula 'entries' must be a call expression (ANSWER_CATALOG.map(...)).");
        }
        if (!ts.isPropertyAccessExpression(propValue.expression)) {
          throw new Error("ANSWER_CATALOG_HASH formula 'entries' must call ANSWER_CATALOG.map(...).");
        }
        const entriesBase = propValue.expression;
        if (!ts.isIdentifier(entriesBase.expression) || entriesBase.expression.text !== "ANSWER_CATALOG" || entriesBase.name.text !== "map") {
          throw new Error("ANSWER_CATALOG_HASH formula 'entries' must call ANSWER_CATALOG.map(...).");
        }
      } else {
        throw new Error(`Unexpected property "${propName}" in ANSWER_CATALOG_HASH formula object.`);
      }
    }
    // Verify all required properties are present
    for (const reqProp of [...Object.keys(expectedHashFormulaProps), "entries"]) {
      if (!seenHashProps.has(reqProp)) {
        throw new Error(`Missing required property "${reqProp}" in ANSWER_CATALOG_HASH formula object.`);
      }
    }
  }

  // Verify ASSISTANT_SELECTOR_PROMPT_HASH formula
  if (promptHashDecl && promptHashDecl.initializer) {
    const unwrapped = unwrapAstExpression(promptHashDecl.initializer);
    if (!ts.isCallExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression) || unwrapped.expression.text !== "sha256") {
      throw new Error("ASSISTANT_SELECTOR_PROMPT_HASH must call sha256().");
    }
    if (unwrapped.arguments.length !== 1 || !ts.isIdentifier(unwrapped.arguments[0]) || unwrapped.arguments[0].text !== "ASSISTANT_SELECTOR_PROMPT") {
      throw new Error("ASSISTANT_SELECTOR_PROMPT_HASH argument must be ASSISTANT_SELECTOR_PROMPT.");
    }
  }

  if (!catalogSeedNode) {
    throw new Error("Missing or invalid CATALOG_SEED array literal in AST.");
  }

  if (!selectorPromptNode) {
    throw new Error("Missing ASSISTANT_SELECTOR_PROMPT declaration in AST.");
  }

  // Parse prompt with strict join check
  let selectorPrompt = "";
  if (ts.isCallExpression(selectorPromptNode)) {
    const expr = selectorPromptNode.expression;
    if (ts.isPropertyAccessExpression(expr) && expr.name.text === "join" && ts.isArrayLiteralExpression(expr.expression)) {
      if (selectorPromptNode.arguments.length !== 1) {
        throw new Error("ASSISTANT_SELECTOR_PROMPT .join() must receive exactly 1 argument.");
      }
      const sep = selectorPromptNode.arguments[0];
      if (!ts.isStringLiteral(sep) || sep.text !== "\n") {
        throw new Error("ASSISTANT_SELECTOR_PROMPT .join() separator argument must be literal '\\n'.");
      }
      const parts: string[] = [];
      for (const elem of expr.expression.elements) {
        if (!ts.isStringLiteral(elem) && !ts.isNoSubstitutionTemplateLiteral(elem)) {
          throw new Error("ASSISTANT_SELECTOR_PROMPT array elements must be string literals.");
        }
        parts.push(elem.text);
      }
      selectorPrompt = parts.join("\n");
    } else {
      throw new Error("Unsupported ASSISTANT_SELECTOR_PROMPT call expression syntax.");
    }
  } else if (ts.isStringLiteral(selectorPromptNode) || ts.isNoSubstitutionTemplateLiteral(selectorPromptNode)) {
    selectorPrompt = selectorPromptNode.text;
  } else {
    throw new Error("Unsupported ASSISTANT_SELECTOR_PROMPT syntax.");
  }

  // Parse CATALOG_SEED items
  const seedEntries: ParsedCatalogSeedItem[] = [];

  for (const element of catalogSeedNode.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error("CATALOG_SEED elements must be object literals.");
    }

    let id: string | null = null;
    let sourceFaqIds: string[] | null = null;
    let selectionHint: string | null = null;
    let answer: string | null = null;
    let sourceNote: string | null = null;

    for (const prop of element.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new Error("Computed or shorthand properties are not permitted in CATALOG_SEED.");
      }
      const propName = prop.name.getText(sourceFile);
      if (propName === "id") {
        if (ts.isStringLiteral(prop.initializer)) id = prop.initializer.text;
      } else if (propName === "sourceFaqIds") {
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          sourceFaqIds = [];
          for (const item of prop.initializer.elements) {
            if (ts.isStringLiteral(item)) sourceFaqIds.push(item.text);
            else throw new Error("sourceFaqIds elements must be string literals.");
          }
        }
      } else if (propName === "selectionHint") {
        if (ts.isStringLiteral(prop.initializer)) selectionHint = prop.initializer.text;
      } else if (propName === "answer") {
        if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
          answer = prop.initializer.text;
        }
      } else if (propName === "sourceNote") {
        if (ts.isStringLiteral(prop.initializer)) sourceNote = prop.initializer.text;
      } else {
        throw new Error(`Unexpected property "${propName}" in CATALOG_SEED item.`);
      }
    }

    if (!id || !sourceFaqIds || !selectionHint || !answer || !sourceNote) {
      throw new Error(`Incomplete CATALOG_SEED entry: missing required fields for ${id ?? "unknown"}.`);
    }

    seedEntries.push({ id, sourceFaqIds, selectionHint, answer, sourceNote });
  }

  return {
    seedEntries,
    selectorPrompt,
    catalogVersion: catalogVersionValue ?? "nova-faq-answer-catalog-v1",
    protocolVersion: selectorProtocolVersionValue ?? "nova-help-selector-v1",
  };
}

let cachedLockedReferenceCatalog: readonly { id: AnswerSelectionId; answer: string; answerHash: string }[] | null = null;

export function loadLockedReferenceCatalog(
  referencePath: string = defaultReferenceCatalogPath,
): readonly { id: AnswerSelectionId; answer: string; answerHash: string }[] {
  if (cachedLockedReferenceCatalog && referencePath === defaultReferenceCatalogPath) {
    return cachedLockedReferenceCatalog;
  }

  if (!fs.existsSync(referencePath)) {
    throw new Error(`Locked reference catalog file not found: ${referencePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(referencePath, "utf8")) as {
    entries: Array<{ id: string; answer: string; answerHash: string }>;
  };

  if (!Array.isArray(raw.entries) || raw.entries.length !== 25) {
    throw new Error(`Locked reference catalog invalid: expected 25 entries in ${referencePath}`);
  }

  const loaded = Object.freeze(
    raw.entries.map((e) =>
      Object.freeze({
        id: e.id as AnswerSelectionId,
        answer: e.answer,
        answerHash: e.answerHash,
      }),
    ),
  );

  if (referencePath === defaultReferenceCatalogPath) {
    cachedLockedReferenceCatalog = loaded;
  }
  return loaded;
}

let cachedLockedBaselineSource: string | null = null;

/**
 * Loads the verified locked baseline responseCatalog.ts source code.
 * Fails closed if the loaded content does not match LOCKED_BASELINE_SHA256.
 */
export function loadLockedBaselineSource(): string {
  if (cachedLockedBaselineSource) {
    return cachedLockedBaselineSource;
  }

  const candidatePaths = [
    defaultBaselineCatalogPath,
    defaultCatalogPath,
    defaultBaselineSnapshotPath,
  ];

  for (const p of candidatePaths) {
    if (!fs.existsSync(p)) continue;
    try {
      if (p.endsWith(".json")) {
        const raw = JSON.parse(fs.readFileSync(p, "utf8"));
        if (typeof raw.fullFileContent === "string" && sha256(raw.fullFileContent) === LOCKED_BASELINE_SHA256) {
          cachedLockedBaselineSource = raw.fullFileContent;
          return raw.fullFileContent;
        }
      } else {
        const content = fs.readFileSync(p, "utf8");
        if (sha256(content) === LOCKED_BASELINE_SHA256) {
          cachedLockedBaselineSource = content;
          return content;
        }
      }
    } catch {
      // Continue to next candidate path
    }
  }

  throw new Error(`Unable to locate verified locked baseline responseCatalog with SHA-256 ${LOCKED_BASELINE_SHA256}`);
}

export type AstStructuralComparisonResult = {
  matches: boolean;
  issue?: string;
  extractedPrompt?: string;
  extractedHints?: Map<string, string>;
};

type ReplacementSpan = {
  start: number;
  end: number;
  replacement: string;
};

function replaceSpansDescending(source: string, spans: ReplacementSpan[]): string {
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  let result = source;
  for (const span of sorted) {
    result = result.slice(0, span.start) + span.replacement + result.slice(span.end);
  }
  return result;
}

type SyntacticToken = {
  kind: ts.SyntaxKind;
  kindName: string;
  text: string;
};

function tokenizeSyntacticTokens(sourceText: string): SyntacticToken[] {
  const sf = ts.createSourceFile("temp.ts", sourceText, ts.ScriptTarget.Latest, true);
  const tokens: SyntacticToken[] = [];
  function visit(n: ts.Node) {
    const children = n.getChildren(sf);
    if (children.length === 0) {
      tokens.push({
        kind: n.kind,
        kindName: ts.SyntaxKind[n.kind],
        text: n.getText(sf),
      });
    } else {
      for (const child of children) {
        visit(child);
      }
    }
  }
  visit(sf);
  return tokens;
}

function compareSyntacticTokens(
  candidateTokens: readonly SyntacticToken[],
  baselineTokens: readonly SyntacticToken[],
): string | null {
  const minLen = Math.min(candidateTokens.length, baselineTokens.length);
  for (let i = 0; i < minLen; i++) {
    const c = candidateTokens[i];
    const b = baselineTokens[i];
    if (c.kind !== b.kind || c.text !== b.text) {
      return `Syntactic token mismatch at token #${i}: got ${c.kindName} ("${c.text}"), expected ${b.kindName} ("${b.text}")`;
    }
  }

  if (candidateTokens.length !== baselineTokens.length) {
    if (candidateTokens.length > baselineTokens.length) {
      const extra = candidateTokens[minLen];
      return `Unexpected extra syntactic token at token #${minLen}: got ${extra.kindName} ("${extra.text}")`;
    } else {
      const missing = baselineTokens[minLen];
      return `Missing expected syntactic token at token #${minLen}: expected ${missing.kindName} ("${missing.text}")`;
    }
  }

  return null;
}

function extractMutableRegions(sourceFile: ts.SourceFile): {
  valid: boolean;
  issue?: string;
  extractedPrompt?: string;
  extractedHints?: Map<string, string>;
  spans: ReplacementSpan[];
} {
  let promptSpan: ReplacementSpan | null = null;
  let extractedPrompt: string | undefined;
  const extractedHints = new Map<string, string>();
  const hintSpans: ReplacementSpan[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;

        if (name === "ASSISTANT_SELECTOR_PROMPT") {
          if (!decl.initializer) {
            return { valid: false, issue: "ASSISTANT_SELECTOR_PROMPT missing initializer", spans: [] };
          }
          const unwrapped = unwrapAstExpression(decl.initializer);
          if (ts.isCallExpression(unwrapped)) {
            const expr = unwrapped.expression;
            if (ts.isPropertyAccessExpression(expr) && expr.name.text === "join" && ts.isArrayLiteralExpression(expr.expression)) {
              if (unwrapped.arguments.length !== 1) {
                return { valid: false, issue: "ASSISTANT_SELECTOR_PROMPT .join() must receive exactly 1 argument", spans: [] };
              }
              const sep = unwrapped.arguments[0];
              if (!ts.isStringLiteral(sep) || sep.text !== "\n") {
                return { valid: false, issue: "ASSISTANT_SELECTOR_PROMPT .join() argument must be literal '\\n'", spans: [] };
              }
              const parts: string[] = [];
              for (const elem of expr.expression.elements) {
                if (!ts.isStringLiteral(elem) && !ts.isNoSubstitutionTemplateLiteral(elem)) {
                  return { valid: false, issue: "ASSISTANT_SELECTOR_PROMPT elements must be string literals", spans: [] };
                }
                parts.push(elem.text);
              }
              extractedPrompt = parts.join("\n");
            } else {
              return { valid: false, issue: "ASSISTANT_SELECTOR_PROMPT unsupported call syntax", spans: [] };
            }
          } else if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
            extractedPrompt = unwrapped.text;
          } else {
            return { valid: false, issue: "ASSISTANT_SELECTOR_PROMPT must be array joined with '\\n' or string literal", spans: [] };
          }

          promptSpan = {
            start: decl.initializer.getStart(sourceFile),
            end: decl.initializer.getEnd(),
            replacement: '"__NORMALIZED_SELECTOR_PROMPT__"',
          };
        } else if (name === "CATALOG_SEED") {
          if (!decl.initializer) {
            return { valid: false, issue: "CATALOG_SEED missing initializer", spans: [] };
          }
          const unwrapped = unwrapAstExpression(decl.initializer);
          if (!ts.isArrayLiteralExpression(unwrapped)) {
            return { valid: false, issue: "CATALOG_SEED must be an array literal", spans: [] };
          }
          if (unwrapped.elements.length !== 25) {
            return {
              valid: false,
              issue: `CATALOG_SEED entries count mismatch: got ${unwrapped.elements.length}, expected 25`,
              spans: [],
            };
          }

          for (let i = 0; i < unwrapped.elements.length; i++) {
            const elem = unwrapped.elements[i];
            if (!ts.isObjectLiteralExpression(elem)) {
              return { valid: false, issue: `CATALOG_SEED element [${i}] must be an object literal`, spans: [] };
            }
            let itemId: string | null = null;
            let hintProp: ts.PropertyAssignment | null = null;
            for (const prop of elem.properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                if (prop.name.text === "id" && ts.isStringLiteral(prop.initializer)) {
                  itemId = prop.initializer.text;
                } else if (prop.name.text === "selectionHint") {
                  hintProp = prop;
                }
              }
            }

            if (!itemId) {
              return { valid: false, issue: `CATALOG_SEED element [${i}] missing string 'id'`, spans: [] };
            }
            if (!hintProp) {
              return { valid: false, issue: `CATALOG_SEED entry "${itemId}" missing 'selectionHint'`, spans: [] };
            }
            const unwrappedHint = unwrapAstExpression(hintProp.initializer);
            if (!ts.isStringLiteral(unwrappedHint) && !ts.isNoSubstitutionTemplateLiteral(unwrappedHint)) {
              return { valid: false, issue: `CATALOG_SEED entry "${itemId}" selectionHint must be a string literal`, spans: [] };
            }

            extractedHints.set(itemId, unwrappedHint.text);
            hintSpans.push({
              start: hintProp.initializer.getStart(sourceFile),
              end: hintProp.initializer.getEnd(),
              replacement: '"__NORMALIZED_SELECTION_HINT__"',
            });
          }
        }
      }
    }
  }

  if (!promptSpan) {
    return { valid: false, issue: "Missing ASSISTANT_SELECTOR_PROMPT declaration", spans: [] };
  }
  if (hintSpans.length !== 25) {
    return { valid: false, issue: `Expected 25 selectionHint spans, found ${hintSpans.length}`, spans: [] };
  }

  return {
    valid: true,
    extractedPrompt,
    extractedHints,
    spans: [promptSpan, ...hintSpans],
  };
}

/**
 * Performs a comprehensive AST structural and syntactic token stream comparison
 * of candidate source code against the locked baseline template.
 *
 * Strict Invariant: ONLY TWO REGIONS ARE PERMITTED TO VARY:
 * 1. The selector prompt content in ASSISTANT_SELECTOR_PROMPT (must be valid array joined with '\n' or string literal).
 * 2. The selectionHint property in each of the 25 CATALOG_SEED items (must be a string literal).
 *
 * After normalizing these two mutable regions to fixed canonical placeholders:
 * 1. The entire remaining syntactic token stream (keywords, identifiers, operators, delimiters, literals)
 *    is verified token-by-token using TypeScript's AST syntax stream.
 * 2. Every AST node and expression operator (unary, binary, postfix) is verified against the locked baseline.
 */
export function compareResponseCatalogToBaseline(
  candidateSourceText: string,
  baselineSourceText?: string,
): AstStructuralComparisonResult {
  const baseText = baselineSourceText ?? loadLockedBaselineSource();
  const candidateFile = ts.createSourceFile("candidate.ts", candidateSourceText, ts.ScriptTarget.Latest, true);
  const baselineFile = ts.createSourceFile("baseline.ts", baseText, ts.ScriptTarget.Latest, true);

  const parseDiagnostics = (candidateFile as any).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    const firstDiag = parseDiagnostics[0];
    const msg = typeof firstDiag.messageText === "string" ? firstDiag.messageText : firstDiag.messageText?.messageText ?? "parse failure";
    return { matches: false, issue: `TypeScript syntax error: ${msg}` };
  }

  // Phase 1: Extract and validate mutable regions in baseline and candidate
  const baselineRegions = extractMutableRegions(baselineFile);
  if (!baselineRegions.valid) {
    throw new Error(`Locked baseline responseCatalog template is corrupted: ${baselineRegions.issue}`);
  }

  const candidateRegions = extractMutableRegions(candidateFile);
  if (!candidateRegions.valid) {
    return { matches: false, issue: candidateRegions.issue };
  }

  // Phase 2: Syntactic token stream comparison on normalized source texts
  const normalizedBaseline = replaceSpansDescending(baseText, baselineRegions.spans);
  const normalizedCandidate = replaceSpansDescending(candidateSourceText, candidateRegions.spans);

  const candidateTokens = tokenizeSyntacticTokens(normalizedCandidate);
  const baselineTokens = tokenizeSyntacticTokens(normalizedBaseline);

  const tokenMismatch = compareSyntacticTokens(candidateTokens, baselineTokens);
  if (tokenMismatch) {
    return { matches: false, issue: tokenMismatch };
  }

  // Phase 3: Recursive AST structural match with explicit operator checks
  let currentCatalogItemId: string | null = null;

  function compareNodes(candidate: ts.Node, baseline: ts.Node, contextPath: string): string | null {
    // Check if we are at ASSISTANT_SELECTOR_PROMPT variable declaration
    if (
      ts.isVariableDeclaration(baseline) &&
      ts.isIdentifier(baseline.name) &&
      baseline.name.text === "ASSISTANT_SELECTOR_PROMPT" &&
      baseline.initializer
    ) {
      if (!ts.isVariableDeclaration(candidate) || !ts.isIdentifier(candidate.name) || candidate.name.text !== "ASSISTANT_SELECTOR_PROMPT") {
        return `${contextPath}: Expected variable declaration ASSISTANT_SELECTOR_PROMPT`;
      }
      return null;
    }

    // Track current CATALOG_SEED item id
    if (ts.isObjectLiteralExpression(baseline)) {
      for (const p of baseline.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "id" && ts.isStringLiteral(p.initializer)) {
          currentCatalogItemId = p.initializer.text;
          break;
        }
      }
    }

    // Check if we are at selectionHint property of a CATALOG_SEED item
    if (
      ts.isPropertyAssignment(baseline) &&
      ts.isIdentifier(baseline.name) &&
      baseline.name.text === "selectionHint" &&
      ts.isStringLiteral(baseline.initializer)
    ) {
      if (!ts.isPropertyAssignment(candidate) || !ts.isIdentifier(candidate.name) || candidate.name.text !== "selectionHint") {
        return `${contextPath}: Expected property assignment for "selectionHint"`;
      }
      return null;
    }

    // All other nodes: strict structural match
    if (candidate.kind !== baseline.kind) {
      return `${contextPath}: Syntax kind mismatch: got ${ts.SyntaxKind[candidate.kind]}, expected ${ts.SyntaxKind[baseline.kind]}`;
    }

    // Operator checks for unary and binary expressions
    if (ts.isPrefixUnaryExpression(baseline) && ts.isPrefixUnaryExpression(candidate)) {
      if (candidate.operator !== baseline.operator) {
        return `${contextPath}: Prefix unary operator mismatch: got ${ts.SyntaxKind[candidate.operator]}, expected ${ts.SyntaxKind[baseline.operator]}`;
      }
    } else if (ts.isPostfixUnaryExpression(baseline) && ts.isPostfixUnaryExpression(candidate)) {
      if (candidate.operator !== baseline.operator) {
        return `${contextPath}: Postfix unary operator mismatch: got ${ts.SyntaxKind[candidate.operator]}, expected ${ts.SyntaxKind[baseline.operator]}`;
      }
    } else if (ts.isBinaryExpression(baseline) && ts.isBinaryExpression(candidate)) {
      if (candidate.operatorToken.kind !== baseline.operatorToken.kind) {
        return `${contextPath}: Binary operator mismatch: got ${ts.SyntaxKind[candidate.operatorToken.kind]}, expected ${ts.SyntaxKind[baseline.operatorToken.kind]}`;
      }
    }

    // Leaf nodes text check
    if (ts.isIdentifier(baseline) && ts.isIdentifier(candidate)) {
      if (candidate.text !== baseline.text) {
        return `${contextPath}: Identifier mismatch: got "${candidate.text}", expected "${baseline.text}"`;
      }
    } else if (ts.isStringLiteral(baseline) && ts.isStringLiteral(candidate)) {
      if (candidate.text !== baseline.text) {
        return `${contextPath}: String literal mismatch: got "${candidate.text.slice(0, 30)}...", expected "${baseline.text.slice(0, 30)}..."`;
      }
    } else if (ts.isNumericLiteral(baseline) && ts.isNumericLiteral(candidate)) {
      if (candidate.text !== baseline.text) {
        return `${contextPath}: Numeric literal mismatch: got "${candidate.text}", expected "${baseline.text}"`;
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(baseline) && ts.isNoSubstitutionTemplateLiteral(candidate)) {
      if (candidate.text !== baseline.text) {
        return `${contextPath}: Template literal mismatch: got "${candidate.text.slice(0, 30)}...", expected "${baseline.text.slice(0, 30)}..."`;
      }
    }

    // Collect and recursively compare all children
    const candidateChildren: ts.Node[] = [];
    const baselineChildren: ts.Node[] = [];
    ts.forEachChild(candidate, (c) => { candidateChildren.push(c); });
    ts.forEachChild(baseline, (c) => { baselineChildren.push(c); });

    if (candidateChildren.length !== baselineChildren.length) {
      return `${contextPath} (${ts.SyntaxKind[baseline.kind]}): Element/child count mismatch: got ${candidateChildren.length}, expected ${baselineChildren.length}`;
    }

    for (let i = 0; i < baselineChildren.length; i++) {
      const childContext = `${contextPath} > ${ts.SyntaxKind[baselineChildren[i].kind]}[${i}]`;
      const err = compareNodes(candidateChildren[i], baselineChildren[i], childContext);
      if (err) return err;
    }

    return null;
  }

  const issue = compareNodes(candidateFile, baselineFile, "SourceFile");
  if (issue) {
    return { matches: false, issue };
  }

  return {
    matches: true,
    extractedPrompt: candidateRegions.extractedPrompt,
    extractedHints: candidateRegions.extractedHints,
  };
}

export type CreateRuntimeSnapshotOptions = {
  role?: SnapshotRole;
  targetFilePath?: string;
  sourceFilePath?: string;
  repoRoot?: string;
  gitMetadata?: {
    gitHead: string;
    workingTreeStatus: "WIP" | "CLEAN";
    workingTreeEntriesCount: number;
  };
};

/**
 * Creates a runtime snapshot of responseCatalog.ts or a specified target file.
 * AST parses the source file directly — never imports or executes arbitrary target code.
 */
export function createRuntimeSnapshot(
  roleOrOptions?: SnapshotRole | CreateRuntimeSnapshotOptions,
  maybeOptions?: CreateRuntimeSnapshotOptions,
): RuntimeSnapshot {
  const options: CreateRuntimeSnapshotOptions =
    typeof roleOrOptions === "string"
      ? { ...maybeOptions, role: roleOrOptions }
      : (roleOrOptions ?? {});

  const root = options?.repoRoot ? path.resolve(options.repoRoot) : path.resolve(process.cwd(), "..");
  const rawTargetPath = options?.targetFilePath ?? options?.sourceFilePath;
  const targetPath = rawTargetPath
    ? path.resolve(rawTargetPath)
    : path.resolve(root, "backend/src/assistant/responseCatalog.ts");

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target file not found for snapshot: ${targetPath}`);
  }

  const rawBytes = fs.readFileSync(targetPath);
  const sourceContent = rawBytes.toString("utf8");
  if (!Buffer.from(sourceContent, "utf8").equals(rawBytes)) {
    throw new Error(`Target file "${targetPath}" is not valid UTF-8 or failed round-trip byte check.`);
  }

  const runtimeFileSha256 = sha256(rawBytes);

  // Parse source via TypeScript AST
  const parsed = parseResponseCatalogAst(sourceContent);

  let gitHead = "unknown";
  let workingTreeStatus: "WIP" | "CLEAN" = "WIP";
  let workingTreeEntriesCount = 0;

  if (options?.gitMetadata) {
    gitHead = options.gitMetadata.gitHead;
    workingTreeStatus = options.gitMetadata.workingTreeStatus;
    workingTreeEntriesCount = options.gitMetadata.workingTreeEntriesCount;
  } else {
    try {
      gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      const statusOut = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
      workingTreeStatus = statusOut.length > 0 ? "WIP" : "CLEAN";
      workingTreeEntriesCount = statusOut.length > 0 ? statusOut.split(/\r?\n/u).length : 0;
    } catch {
      // Fallback if git is unavailable in test environment
    }
  }

  const selectorPromptHash = sha256(parsed.selectorPrompt);

  const entries: SnapshotCatalogEntry[] = parsed.seedEntries.map((entry) => ({
    id: entry.id as AnswerSelectionId,
    selectionHint: entry.selectionHint,
    answer: entry.answer,
    answerHash: sha256(entry.answer),
  }));

  const answerCatalogHash = sha256(
    JSON.stringify({
      version: parsed.catalogVersion,
      sourceFaqVersion: FAQ_VERSION,
      sourceFaqHash: FAQ_HASH,
      sourcePromptVersion: PROMPT_VERSION,
      sourcePromptHash: PROMPT_HASH,
      entries: parsed.seedEntries.map(({ id, sourceFaqIds, selectionHint, answer, sourceNote }) => ({
        id,
        sourceFaqIds,
        selectionHint,
        answer,
        sourceNote,
        answerHash: sha256(answer),
      })),
    }),
  );

  const targetRelativePath = path.relative(root, targetPath).replace(/\\/gu, "/");

  return {
    snapshotVersion: RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    snapshotRole: options?.role ?? "rollback_target",
    gitHead,
    workingTreeStatus,
    workingTreeEntriesCount,
    targetRelativePath,
    runtimeFileSha256,
    sourceContent,
    selectorPromptHash,
    answerCatalogHash,
    catalogVersion: parsed.catalogVersion,
    faqVersion: FAQ_VERSION,
    faqHash: FAQ_HASH,
    entries,
  };
}

/**
 * Validates a snapshot object against structural, cryptographic, AST, and reference catalog invariants.
 * Does NOT execute any code from the snapshot.
 */
export function verifyRuntimeSnapshot(
  snapshot: unknown,
  referenceCatalog?: readonly { id: AnswerSelectionId; answer: string; answerHash: string }[],
): SnapshotVerificationResult {
  const issues: string[] = [];

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      valid: false,
      issues: ["Snapshot must be a non-null object."],
      entriesCount: 0,
      runtimeFileSha256: "",
      selectorPromptHash: "",
      answerCatalogHash: "",
    };
  }

  const s = snapshot as Partial<RuntimeSnapshot>;

  if (s.snapshotVersion !== RUNTIME_SNAPSHOT_SCHEMA_VERSION) {
    issues.push(`Invalid snapshotVersion: expected "${RUNTIME_SNAPSHOT_SCHEMA_VERSION}", got "${String(s.snapshotVersion)}".`);
  }

  const validRoles: SnapshotRole[] = ["control", "candidate", "rollback_target"];
  if (!s.snapshotRole || !validRoles.includes(s.snapshotRole)) {
    issues.push(`Invalid snapshotRole: must be one of ${validRoles.join(", ")}.`);
  }

  // Strict 64-char hex format checks for all recorded hashes
  if (!HASH_REGEX.test(String(s.runtimeFileSha256 ?? ""))) {
    issues.push(`Invalid runtimeFileSha256: must be a 64-character lowercase hex string.`);
  }
  if (!HASH_REGEX.test(String(s.selectorPromptHash ?? ""))) {
    issues.push(`Invalid selectorPromptHash: must be a 64-character lowercase hex string.`);
  }
  if (!HASH_REGEX.test(String(s.answerCatalogHash ?? ""))) {
    issues.push(`Invalid answerCatalogHash: must be a 64-character lowercase hex string.`);
  }

  let parsedAst: ParsedCatalogAst | null = null;

  if (typeof s.sourceContent !== "string" || s.sourceContent.length === 0) {
    issues.push("Missing or empty sourceContent.");
  } else {
    const contentBuffer = Buffer.from(s.sourceContent, "utf8");
    if (contentBuffer.toString("utf8") !== s.sourceContent) {
      issues.push("sourceContent failed UTF-8 round-trip byte integrity check.");
    }
    const computedFileSha256 = sha256(contentBuffer);
    if (s.runtimeFileSha256 !== computedFileSha256) {
      issues.push(`runtimeFileSha256 mismatch: recorded "${s.runtimeFileSha256}", computed "${computedFileSha256}".`);
    }

    // AST Parse sourceContent to verify actual code structure
    try {
      parsedAst = parseResponseCatalogAst(s.sourceContent);
    } catch (astErr: any) {
      issues.push(`sourceContent failed AST validation: ${astErr?.message ?? "unknown parser error"}`);
    }

    // Comprehensive structural comparison against the locked baseline template:
    // Only two regions are permitted to vary: prompt content and selectionHint values.
    // Every other node (imports, declarations, functions, callbacks, object shapes, return expressions, etc.)
    // MUST strictly match the locked baseline AST.
    try {
      const structuralComparison = compareResponseCatalogToBaseline(s.sourceContent);
      if (!structuralComparison.matches) {
        issues.push(`sourceContent failed baseline structural comparison: ${structuralComparison.issue}`);
      }
    } catch (compErr: any) {
      issues.push(`sourceContent failed baseline structural comparison execution: ${compErr?.message ?? "unknown error"}`);
    }
  }

  if (typeof s.targetRelativePath !== "string" || s.targetRelativePath.includes("..") || path.isAbsolute(s.targetRelativePath)) {
    issues.push(`Invalid targetRelativePath: must be relative within repo without path traversal: "${String(s.targetRelativePath)}".`);
  }

  if (parsedAst) {
    // Verify selectorPromptHash against AST
    const recomputedPromptHash = sha256(parsedAst.selectorPrompt);
    if (s.selectorPromptHash !== recomputedPromptHash) {
      issues.push(`selectorPromptHash mismatch: recorded "${s.selectorPromptHash}", recomputed from AST "${recomputedPromptHash}".`);
    }

    // Verify answerCatalogHash against AST using exact runtime formula
    const recomputedCatalogHash = sha256(
      JSON.stringify({
        version: parsedAst.catalogVersion,
        sourceFaqVersion: s.faqVersion ?? FAQ_VERSION,
        sourceFaqHash: s.faqHash ?? FAQ_HASH,
        sourcePromptVersion: PROMPT_VERSION,
        sourcePromptHash: PROMPT_HASH,
        entries: parsedAst.seedEntries.map(({ id, sourceFaqIds, selectionHint, answer, sourceNote }) => ({
          id,
          sourceFaqIds,
          selectionHint,
          answer,
          sourceNote,
          answerHash: sha256(answer),
        })),
      }),
    );
    if (s.answerCatalogHash !== recomputedCatalogHash) {
      issues.push(`answerCatalogHash mismatch: recorded "${s.answerCatalogHash}", recomputed from AST "${recomputedCatalogHash}".`);
    }

    // Verify recorded entries match AST seed entries
    if (Array.isArray(s.entries)) {
      if (s.entries.length !== parsedAst.seedEntries.length) {
        issues.push(`entries count mismatch with AST: recorded ${s.entries.length}, AST has ${parsedAst.seedEntries.length}.`);
      }
      for (let i = 0; i < parsedAst.seedEntries.length; i++) {
        const astEntry = parsedAst.seedEntries[i];
        const snapEntry = s.entries[i];
        if (snapEntry) {
          if (snapEntry.id !== astEntry.id) {
            issues.push(`Entry index ${i} ID mismatch: recorded "${snapEntry.id}", AST has "${astEntry.id}".`);
          }
          if (snapEntry.selectionHint !== astEntry.selectionHint) {
            issues.push(`Entry "${snapEntry.id}" selectionHint differs from source AST.`);
          }
          if (snapEntry.answer !== astEntry.answer) {
            issues.push(`Entry "${snapEntry.id}" answer differs from source AST.`);
          }
        }
      }
    }
  }

  if (!Array.isArray(s.entries)) {
    issues.push("entries must be an array.");
  } else {
    if (s.entries.length !== 25) {
      issues.push(`entries count mismatch: expected 25, got ${s.entries.length}.`);
    }

    const seenIds = new Set<string>();
    for (const entry of s.entries) {
      if (!entry || typeof entry !== "object") {
        issues.push("Invalid entry structure in entries.");
        continue;
      }
      if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
        issues.push("Entry missing valid id.");
        continue;
      }
      if (seenIds.has(entry.id)) {
        issues.push(`Duplicate entry ID: "${entry.id}".`);
      }
      seenIds.add(entry.id);

      if (typeof entry.answer !== "string") {
        issues.push(`Entry "${entry.id}" missing answer string.`);
        continue;
      }
      const computedAnswerHash = sha256(entry.answer);
      if (entry.answerHash !== computedAnswerHash) {
        issues.push(`Entry "${entry.id}" answerHash mismatch: recorded "${entry.answerHash}", computed "${computedAnswerHash}".`);
      }
    }

    // Verify immutable answer integrity against locked independent reference catalog
    const ref = referenceCatalog ?? loadLockedReferenceCatalog();
    const refMap = new Map(ref.map((item) => [item.id, item]));

    for (const refEntry of ref) {
      if (!seenIds.has(refEntry.id)) {
        issues.push(`Missing catalog entry for required ID: "${refEntry.id}".`);
      }
    }

    for (const entry of s.entries) {
      const expectedRef = refMap.get(entry.id as AnswerSelectionId);
      if (expectedRef) {
        if (entry.answer !== expectedRef.answer) {
          issues.push(`Entry "${entry.id}" answer content differs from locked reference catalog.`);
        }
        if (entry.answerHash !== expectedRef.answerHash) {
          issues.push(`Entry "${entry.id}" answerHash differs from locked reference catalog.`);
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    entriesCount: Array.isArray(s.entries) ? s.entries.length : 0,
    runtimeFileSha256: s.runtimeFileSha256 ?? "",
    selectorPromptHash: s.selectorPromptHash ?? "",
    answerCatalogHash: s.answerCatalogHash ?? "",
  };
}

/**
 * Restores a snapshot into a target file safely with path containment guards and WIP conflict guards.
 * Force bypass has been completely removed.
 */
export function restoreRuntimeSnapshot(
  snapshot: RuntimeSnapshot,
  options: {
    targetFilePath: string;
    allowedWorkspaceDir: string;
    expectedCurrentHash: string;
  },
): { restored: boolean; targetFile: string; hashAfterRestore: string } {
  if (!options.allowedWorkspaceDir) {
    throw new Error("allowedWorkspaceDir is required for safe restore.");
  }
  if (!fs.existsSync(options.allowedWorkspaceDir)) {
    throw new Error(`Allowed workspace dir does not exist: "${options.allowedWorkspaceDir}".`);
  }
  const realWorkspace = fs.realpathSync(options.allowedWorkspaceDir);

  if (!options.targetFilePath) {
    throw new Error("targetFilePath is required for safe restore.");
  }
  const resolvedTarget = path.resolve(options.targetFilePath);

  // Path containment guard: check containment before inspecting target existence
  let canonicalTarget: string;
  try {
    if (fs.existsSync(resolvedTarget)) {
      canonicalTarget = fs.realpathSync(resolvedTarget);
    } else {
      const parentDir = path.dirname(resolvedTarget);
      canonicalTarget = fs.existsSync(parentDir)
        ? path.join(fs.realpathSync(parentDir), path.basename(resolvedTarget))
        : resolvedTarget;
    }
  } catch {
    canonicalTarget = resolvedTarget;
  }

  const relative = path.relative(realWorkspace, canonicalTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path containment rejected: target "${canonicalTarget}" is outside allowed workspace "${realWorkspace}".`);
  }

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target file does not exist: "${resolvedTarget}".`);
  }
  const realTarget = fs.realpathSync(resolvedTarget);

  // WIP Guard: Verify current hash of the target file
  const currentBytes = fs.readFileSync(realTarget);
  const currentHash = sha256(currentBytes);

  if (!options.expectedCurrentHash || currentHash !== options.expectedCurrentHash) {
    throw new Error(
      `Restore rejected to prevent overwriting WIP: target current hash "${currentHash}" does not match expected pre-state "${options.expectedCurrentHash}".`,
    );
  }

  // Verify snapshot integrity before writing
  const verification = verifyRuntimeSnapshot(snapshot);
  if (!verification.valid) {
    throw new Error(`Cannot restore corrupted snapshot: ${verification.issues.join("; ")}`);
  }

  // Safe atomic write: write to temp sibling in the same folder, then rename
  const tempPath = `${realTarget}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tempPath, snapshot.sourceContent, { flag: "wx", encoding: "utf8" });
    fs.renameSync(tempPath, realTarget);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup error
      }
    }
    throw err;
  }

  const restoredHash = sha256(fs.readFileSync(realTarget));
  return {
    restored: true,
    targetFile: realTarget,
    hashAfterRestore: restoredHash,
  };
}
