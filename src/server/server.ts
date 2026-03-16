import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  CompletionItem,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  Hover,
  DefinitionParams,
  SignatureHelpParams,
  SignatureHelp,
  CompletionParams,
  DocumentSymbolParams,
  DocumentSymbol,
  FoldingRangeParams,
  FoldingRange,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { treeSitterParser } from "./treeSitterParser";
import { parseSnippets, doCompletion, doCompletionResolve, doGoToDef, doHover, doSignHelp, resetAutocompletes, doDocumentSymbol, doFoldingRange } from "./parser";

export const connection = createConnection(ProposedFeatures.all);
export const documents = new TextDocuments(TextDocument);
documents.listen(connection);
connection.listen();

connection.onInitialize(async () => {
  await treeSitterParser.initialize();
  connection.console.log("Pawn Tree-sitter parser initialized successfully.");
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: true,
      },
      definitionProvider: true,
      hoverProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
      },
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      workspace: {
        workspaceFolders: {
          supported: true,
        },
      },
    },
  };
});

// connection.onInitialized(() => {});

connection.onNotification("revalidateAllOpenedDocuments", () => {
  resetAutocompletes();
  documents.all().forEach((doc) => parseSnippets(doc));
});

connection.onDidChangeConfiguration(() => {
  documents.all().forEach((doc) => parseSnippets(doc));
});

// documents.onDidClose(() => {});

documents.onDidChangeContent((change) => {
  parseSnippets(change.document, false);
});

documents.onDidSave((change) => {
  parseSnippets(change.document);
});

// connection.onDidChangeWatchedFiles((_change) => {});

connection.onDefinition((textDocumentIdentifier: DefinitionParams) => {
  const doc = documents.get(textDocumentIdentifier.textDocument.uri);
  if (doc === undefined) return;
  return doGoToDef(doc, textDocumentIdentifier.position);
});

connection.onHover((params: TextDocumentPositionParams): Hover | undefined => {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) return;
  return doHover(doc, params.position);
});

connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | undefined => {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) return;
  return doSignHelp(doc, params.position);
});

connection.onCompletion(async (params: CompletionParams) => {
  const completionItems = await doCompletion(params);
  if (completionItems === undefined) return undefined;
  return { isIncomplete: false, items: completionItems };
});

connection.onCompletionResolve(async (item: CompletionItem): Promise<CompletionItem> => {
  return await doCompletionResolve(item);
});

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] | undefined => {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) return;
  return doDocumentSymbol(doc);
});

connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] | undefined => {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) return;
  return doFoldingRange(doc);
});

connection.onRequest("pawn/getTree", (params: { uri: string }) => {
  const doc = documents.get(params.uri);
  if (doc === undefined) return;
  const tree = treeSitterParser.getTree(doc);
  if (!tree) return "No tree found";

  const printNode = (node: any, depth = 0): string => {
    let res = `${"  ".repeat(depth)}${node.type} [${node.startPosition.row}:${node.startPosition.column} - ${node.endPosition.row}:${node.endPosition.column}]\n`;
    for (let i = 0; i < node.childCount; i++) {
      res += printNode(node.child(i), depth + 1);
    }
    return res;
  };

  return printNode(tree);
});
