import {
  CompletionItem,
  CompletionItemKind,
  Definition,
  Location,
  Hover,
  SignatureHelp,
  Position,
  ParameterInformation,
  CompletionParams,
  MarkupContent,
  MarkupKind,
} from "vscode-languageserver";
import { findFunctionIdentifier, positionToIndex, findIdentifierAtCursor, isPawnExt } from "./common";
import { treeSitterParser, PawnSymbol } from "./treeSitterParser";
import { TextDocument } from "vscode-languageserver-textdocument";
import { connection } from "./server";
import { DocumentSymbol, SymbolKind, FoldingRange } from "vscode-languageserver";
import * as fs from "fs";
import * as url from "url";
import * as path from "path";

interface PawnFunction {
  type: "macrodefine" | "customsnip" | "function" | "macrofunction" | "native" | "forward";
  textDocument: TextDocument;
  completion: CompletionItem;
  definition: Definition;
  params?: ParameterInformation[];
  summary?: string;
}
const pawnFuncCollection: Map<string, PawnFunction> = new Map();
const pawnWords: Map<string, CompletionItem[]> = new Map();

const commentRegex = RegExp(/\/\*/gm);
const commentEndRegex = RegExp(/\*\//gm);

export const resetAutocompletes = () => {
  pawnFuncCollection.clear();
};

export const parseDefine = (textDocument: TextDocument) => {
  const regexDefine = /^(\s*)#define\s+([^\s()]{1,})\s+([^\s]{1,})$/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");
  let excempt = 0;
  splitContent.forEach((cont: string, index: number) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0) {
      let m;
      do {
        m = regexDefine.exec(cont);
        if (m) {
          const func = m[2];
          const arg = m[3];
          const newSnip: CompletionItem = {
            label: func,
            kind: CompletionItemKind.Text,
            insertText: func,
            documentation: `${func} ${arg}`,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: m.input.indexOf(func) },
            end: {
              line: index,
              character: m.input.indexOf(func) + func.length,
            },
          });
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            completion: newSnip,
            definition: newDef,
            type: "macrodefine",
          };
          const findSnip = pawnFuncCollection.get(func);
          if (findSnip === undefined) pawnFuncCollection.set(func, pwnFun);
        }
      } while (m);
    }
  });
};

// Pawn reserved keywords that should never appear as autocomplete items
// (even if defined as macros in included files like YSI's foreach)
const PAWN_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default",
  "return", "break", "continue", "goto", "new", "static", "const",
  "stock", "public", "forward", "native", "hook", "enum", "sizeof",
  "tagof", "defined", "assert", "foreach", "state", "sleep", "exit",
  "align", "amxlimit", "amxram", "codepage", "ctrlchar", "deprecated",
  "dynamic", "export", "File", "Fixed", "Float", "in", "library",
  "operator", "overlay", "pack", "rational", "semicolon", "tabsize",
  "unused", "bool", "true", "false",
]);

export const parseFuncsDefines = (textDocument: TextDocument) => {
  const regex = /^(\s*)#define\s+([\S]{1,})\((.*?)\)/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");
  let excempt = 0;
  splitContent.forEach((cont: string, index: number) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0) {
      let m;
      do {
        m = regex.exec(cont);
        if (m) {
          const func = m[2];
          const args = m[3];
          let doc = "";
          let endDoc = -1;
          if (splitContent[index - 1] !== undefined) endDoc = splitContent[index - 1].indexOf("*/");
          if (endDoc !== -1) {
            let startDoc = -1;
            let inNum = index;
            while (inNum >= 0) {
              inNum--;
              if (splitContent[inNum] === undefined) continue;
              startDoc = splitContent[inNum].indexOf("/*");
              if (startDoc !== -1) {
                if (inNum === index) {
                  doc = splitContent[index];
                } else if (inNum < index) {
                  while (inNum < index) {
                    doc += splitContent[inNum] + "\n\n";
                    inNum++;
                  }
                }
                break;
              }
            }
          }
          const parsedDoc = treeSitterParser.parseXmlDoc(doc);
          const summary = treeSitterParser.parseXmlDoc(doc, true);
          const newSnip: CompletionItem = {
            label: func + "(" + args + ")",
            kind: CompletionItemKind.Function,
            insertText: func + "(" + args + ")",
            documentation: parsedDoc,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: m.input.indexOf(args) },
            end: {
              line: index,
              character: m.input.indexOf(args) + args.length,
            },
          });
          let params: ParameterInformation[] = [];
          if (args.trim().length > 0) {
            params = args.split(",").map((value) => ({ label: value.trim() }));
          } else {
            params = [];
          }
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            definition: newDef,
            completion: newSnip,
            params,
            type: "macrofunction",
          };
          // const indexPos = func.indexOf(':');
          // if (indexPos !== -1) {
          // const resOut = /:(.*)/gm.exec(func);
          // if (resOut) func = resOut[1];
          // }
          if (PAWN_KEYWORDS.has(func)) continue; // Skip reserved keywords
          const findSnip = pawnFuncCollection.get(func);
          if (findSnip === undefined) {
            pawnFuncCollection.set(func, pwnFun);
          } else {
            if (findSnip.type === "macrodefine") pawnFuncCollection.set(func, pwnFun);
          }
        }
      } while (m);
    }
  });
};

export const parseCustomSnip = (textDocument: TextDocument) => {
  const regexDefine = /^\/\/#snippet\s([^\s]{1,})\s([^\s].{1,})$/gm;
  const regexFunction = /^\/\/#function\s([\S]{1,})\((.*?)\)/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");

  let excempt = 0;
  splitContent.forEach((cont: string, index: number) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0) {
      let fisrtReg;
      do {
        fisrtReg = regexDefine.exec(cont);
        if (fisrtReg) {
          const func = fisrtReg[1];
          const args = fisrtReg[2];
          const newSnip: CompletionItem = {
            label: func,
            kind: CompletionItemKind.Function,
            insertText: args,
            documentation: `${func} ${args}`,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: fisrtReg.input.indexOf(func) },
            end: {
              line: index,
              character: fisrtReg.input.indexOf(func) + func.length,
            },
          });
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            completion: newSnip,
            definition: newDef,
            type: "customsnip",
          };
          pawnFuncCollection.set(func, pwnFun);
        }
      } while (fisrtReg);
      let m;
      do {
        m = regexFunction.exec(cont);
        if (m) {
          const func = m[1];
          const args = m[2];
          let doc = "";
          let endDoc = -1;
          if (splitContent[index - 1] !== undefined) endDoc = splitContent[index - 1].indexOf("*/");
          if (endDoc !== -1) {
            let startDoc = -1;
            let inNum = index;
            while (inNum >= 0) {
              inNum--;
              if (splitContent[inNum] === undefined) continue;
              startDoc = splitContent[inNum].indexOf("/*");
              if (startDoc !== -1) {
                if (inNum === index) {
                  doc = splitContent[index];
                } else if (inNum < index) {
                  while (inNum < index) {
                    doc += splitContent[inNum] + "\n\n";
                    inNum++;
                  }
                }
                break;
              }
            }
          }
          doc = doc.replace("/*", "").replace("*/", "").trim();
          const newSnip: CompletionItem = {
            label: func + "(" + args + ")",
            kind: CompletionItemKind.Function,
            insertText: func + "(" + args + ")",
            documentation: doc,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: m.input.indexOf(func) },
            end: {
              line: index,
              character: m.input.indexOf(func) + func.length,
            },
          });
          let params: ParameterInformation[] = [];
          if (args.trim().length > 0) {
            params = args.split(",").map((value) => ({ label: value.trim() }));
          } else {
            params = [];
          }
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            definition: newDef,
            completion: newSnip,
            params,
            type: "customsnip",
          };
          // const indexPos = func.indexOf(':');
          // if (indexPos !== -1) {
          // const resOut = /:(.*)/gm.exec(func);
          // if (resOut) func = resOut[1];
          // }
          pawnFuncCollection.set(func, pwnFun);
        }
      } while (m);
    }
  });
};

export const parseFuncs = (textDocument: TextDocument) => {
  const regex = /^(\s*)(public|stock|function|func)\s+([\S]{1,})\((.*?)\)/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");
  let excempt = 0;
  splitContent.forEach((cont: string, index: number) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0) {
      let m;
      do {
        m = regex.exec(cont);
        if (m) {
          const func = m[3];
          const args = m[4];
          let doc = "";
          let endDoc = -1;
          if (splitContent[index - 1] !== undefined) endDoc = splitContent[index - 1].indexOf("*/");
          if (endDoc !== -1) {
            let startDoc = -1;
            let inNum = index;
            while (inNum >= 0) {
              inNum--;
              if (splitContent[inNum] === undefined) continue;
              startDoc = splitContent[inNum].indexOf("/*");
              if (startDoc !== -1) {
                if (inNum === index) {
                  doc = splitContent[index];
                } else if (inNum < index) {
                  while (inNum < index) {
                    doc += splitContent[inNum] + "\n\n";
                    inNum++;
                  }
                }
                break;
              }
            }
          }
          doc = doc.replace("/*", "").replace("*/", "").trim();
          const noTagFunc = func.replace(/^[^:]*:/gm, "");
          const newSnip: CompletionItem = {
            label: func + "(" + args + ")",
            kind: CompletionItemKind.Function,
            insertText: noTagFunc,
            documentation: doc,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: m.input.indexOf(noTagFunc) },
            end: {
              line: index,
              character: m.input.indexOf(noTagFunc) + noTagFunc.length,
            },
          });
          let params: ParameterInformation[] = [];
          if (args.trim().length > 0) {
            params = args.split(",").map((value) => ({ label: value.trim() }));
          } else {
            params = [];
          }
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            definition: newDef,
            completion: newSnip,
            params,
            type: "function",
          };

          const findSnip = pawnFuncCollection.get(noTagFunc);
          if (findSnip === undefined) {
            pawnFuncCollection.set(noTagFunc, pwnFun);
          } else {
            if (
              findSnip.type === "macrofunction" ||
              findSnip.type === "macrodefine" ||
              findSnip.type === "customsnip" ||
              findSnip.type === "forward"
            )
              pawnFuncCollection.set(noTagFunc, pwnFun);
          }
        }
      } while (m);
    }
  });
};

export const parseForward = (textDocument: TextDocument) => {
  const regex = /^(\s*)(forward)\s+([\S]{1,})\((.*?)\)/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");
  let excempt = 0;
  splitContent.forEach((cont: string, index: number) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0) {
      let m;
      do {
        m = regex.exec(cont);
        if (m) {
          const func = m[3];
          const args = m[4];
          let doc = "";
          let endDoc = -1;
          if (splitContent[index - 1] !== undefined) endDoc = splitContent[index - 1].indexOf("*/");
          if (endDoc !== -1) {
            let startDoc = -1;
            let inNum = index;
            while (inNum >= 0) {
              inNum--;
              if (splitContent[inNum] === undefined) continue;
              startDoc = splitContent[inNum].indexOf("/*");
              if (startDoc !== -1) {
                if (inNum === index) {
                  doc = splitContent[index];
                } else if (inNum < index) {
                  while (inNum < index) {
                    doc += splitContent[inNum] + "\n\n";
                    inNum++;
                  }
                }
                break;
              }
            }
          }
          doc = doc.replace("/*", "").replace("*/", "").trim();
          const noTagFunc = func.replace(/^[^:]*:/gm, "");
          const newSnip: CompletionItem = {
            label: func + "(" + args + ")",
            kind: CompletionItemKind.Function,
            insertText: func + "(" + args + ")",
            documentation: doc,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: m.input.indexOf(noTagFunc) },
            end: {
              line: index,
              character: m.input.indexOf(noTagFunc) + noTagFunc.length,
            },
          });
          let params: ParameterInformation[] = [];
          if (args.trim().length > 0) {
            params = args.split(",").map((value) => ({ label: value.trim() }));
          } else {
            params = [];
          }
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            definition: newDef,
            completion: newSnip,
            params,
            type: "forward",
          };

          const findSnip = pawnFuncCollection.get(noTagFunc);
          if (findSnip === undefined) {
            pawnFuncCollection.set(noTagFunc, pwnFun);
          } else {
            if (findSnip.type === "macrofunction" || findSnip.type === "macrodefine" || findSnip.type === "customsnip")
              pawnFuncCollection.set(noTagFunc, pwnFun);
          }
        }
      } while (m);
    }
  });
};

export const parseFuncsNonPrefix = (textDocument: TextDocument) => {
  const regex = /^([\S]{1,})\((.*?)\)/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");
  let excempt = 0;
  splitContent.forEach((cont: string, index: number) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0) {
      let m;
      do {
        m = regex.exec(cont);
        if (m) {
          const func = m[1];
          const args = m[2];
          let doc = "";
          let endDoc = -1;
          if (splitContent[index - 1] !== undefined) endDoc = splitContent[index - 1].indexOf("*/");
          if (endDoc !== -1) {
            let startDoc = -1;
            let inNum = index;
            while (inNum >= 0) {
              inNum--;
              if (splitContent[inNum] === undefined) continue;
              startDoc = splitContent[inNum].indexOf("/*");
              if (startDoc !== -1) {
                if (inNum === index) {
                  doc = splitContent[index];
                } else if (inNum < index) {
                  while (inNum < index) {
                    doc += splitContent[inNum] + "\n\n";
                    inNum++;
                  }
                }
                break;
              }
            }
          }
          const parsedDoc = treeSitterParser.parseXmlDoc(doc);
          const summary = treeSitterParser.parseXmlDoc(doc, true);
          const noTagFunc = func.replace(/^[^:]*:/gm, "");
          const newSnip: CompletionItem = {
            label: func + "(" + args + ")",
            kind: CompletionItemKind.Function,
            insertText: noTagFunc,
            documentation: parsedDoc,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: m.input.indexOf(noTagFunc) },
            end: {
              line: index,
              character: m.input.indexOf(noTagFunc) + noTagFunc.length,
            },
          });
          let params: ParameterInformation[] = [];
          if (args.trim().length > 0) {
            params = args.split(",").map((value) => ({ label: value.trim() }));
          } else {
            params = [];
          }
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            definition: newDef,
            completion: newSnip,
            params,
            type: "function",
            summary: summary
          };
          const findSnip = pawnFuncCollection.get(noTagFunc);
          if (findSnip === undefined) {
            pawnFuncCollection.set(noTagFunc, pwnFun);
          } else {
            const oldPrio = getPriority(findSnip.type);
            const newPrio = getPriority("function");
            if (newPrio >= oldPrio) pawnFuncCollection.set(noTagFunc, pwnFun);
          }
        }
      } while (m);
    }
  });
};

export const parseNatives = (textDocument: TextDocument) => {
  const regex = /^(\s*)(native)\s([\S]{1,})\((.*?)\)/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");
  let excempt = 0;
  splitContent.forEach((cont: string, index: number) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0) {
      let m;
      do {
        m = regex.exec(cont);
        if (m) {
          const func = m[3];
          const args = m[4];
          let doc = "";
          let endDoc = -1;
          if (splitContent[index - 1] !== undefined) endDoc = splitContent[index - 1].indexOf("*/");
          if (endDoc !== -1) {
            let startDoc = -1;
            let inNum = index;
            while (inNum >= 0) {
              inNum--;
              if (splitContent[inNum] === undefined) continue;
              startDoc = splitContent[inNum].indexOf("/*");
              if (startDoc !== -1) {
                if (inNum === index) {
                  doc = splitContent[index];
                } else if (inNum < index) {
                  while (inNum < index) {
                    doc += splitContent[inNum] + "\n\n";
                    inNum++;
                  }
                }
                break;
              }
            }
          }
          const parsedDoc = treeSitterParser.parseXmlDoc(doc);
          const summary = treeSitterParser.parseXmlDoc(doc, true);
          const noTagFunc = func.replace(/^[^:]*:/gm, "");
          const newSnip: CompletionItem = {
            label: func + "(" + args + ")",
            kind: CompletionItemKind.Function,
            insertText: noTagFunc,
            documentation: parsedDoc,
          };
          const newDef: Definition = Location.create(textDocument.uri, {
            start: { line: index, character: m.input.indexOf(noTagFunc) },
            end: {
              line: index,
              character: m.input.indexOf(noTagFunc) + noTagFunc.length,
            },
          });
          let params: ParameterInformation[] = [];
          if (args.trim().length > 0) {
            params = args.split(",").map((value) => {
              const trimmed = value.trim();
              // Strip tag prefix (e.g. "Float:spawnX") and default value (e.g. "= false") to match <param name="..."> in XML doc
              const bareParam = trimmed.replace(/^[^:]*:/, "").replace(/\s*=.*$/, "").replace(/[&*[\]]/g, "").trim();
              const escapedParam = escapeRegExp(bareParam);
              const paramMatch = doc.match(new RegExp(`<param name="${escapedParam}">(.*?)<\\/param>`, "is"));
              const paramDoc = paramMatch ? treeSitterParser.parseXmlDoc(paramMatch[1].trim()) : undefined;
              return { label: trimmed, documentation: paramDoc };
            });
          } else {
            params = [];
          }
          const pwnFun: PawnFunction = {
            textDocument: textDocument,
            definition: newDef,
            completion: newSnip,
            params,
            type: "native",
            summary: summary
          };
          const findSnip = pawnFuncCollection.get(noTagFunc);
          if (findSnip === undefined) {
            pawnFuncCollection.set(noTagFunc, pwnFun);
          } else {
            const oldPrio = getPriority(findSnip.type);
            const newPrio = getPriority("native");
            if (newPrio >= oldPrio) pawnFuncCollection.set(noTagFunc, pwnFun);
          }
        }
      } while (m);
    }
  });
};

export const parseWords = (textDocument: TextDocument) => {
  const regex = /[A-Za-z_:0-9]+/gm;
  const content = textDocument.getText();
  const splitContent = content.split("\n");
  const words: string[] = [];
  const wordCompletion: CompletionItem[] = [];
  let excempt = 0;
  splitContent.forEach((cont: string) => {
    if (commentRegex.test(cont)) {
      excempt++;
      // This is for single line block of comment, for example: 
      // /* Some comment text here */
      if (commentEndRegex.test(cont)) {
        excempt--;
      }
    } else if (commentEndRegex.test(cont)) {
      excempt--;
    } else if (excempt === 0 && !RegExp(/^\/\//gm).test(cont.trim())) {
      let m;
      do {
        m = regex.exec(cont);
        if (m) {
          if (words.indexOf(m[0]) === -1) words.push(m[0]);
        }
      } while (m);
    }
  });
  for (const key in words) {
    const element = words[key];
    const newSnip: CompletionItem = {
      label: element,
      kind: CompletionItemKind.Text,
      insertText: element,
    };
    wordCompletion.push(newSnip);
  }
  pawnWords.set(textDocument.uri, wordCompletion);
};

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
};

const getTextDocumentWorkspacePath = async (textDocument: TextDocument) => {
  const workspaceFolders = await connection.workspace.getWorkspaceFolders();
  if (workspaceFolders === null) return undefined;
  for (const workspace of workspaceFolders) {
    if (RegExp(workspace.uri).test(textDocument.uri)) return workspace;
  }
  return undefined;
};

const isParseAllowed = async (textDocument: TextDocument) => {
  const workspace = await getTextDocumentWorkspacePath(textDocument);
  if (workspace !== undefined) {
    const whiteListedPathFile = path.join(url.fileURLToPath(workspace.uri), "/.pawnignore");
    if (fs.existsSync(whiteListedPathFile)) {
      const data = fs.readFileSync(whiteListedPathFile, { encoding: "utf-8" });
      const allLines = data.split("\n").filter((line) => line.length > 0);
      if (allLines.length > 0) {
        for (const line of allLines) {
          if (!RegExp(/^\/\/ .*/).test(line)) {
            const filePath = url.fileURLToPath(textDocument.uri);
            const workspaceWhitlistedPath = path.join(url.fileURLToPath(workspace.uri), line);
            if (RegExp(url.pathToFileURL(workspaceWhitlistedPath).toString()).test(url.pathToFileURL(filePath).toString())) {
              return false;
            }
          }
        }
      }
    }
  }
  return true;
};

const pawnSymbolToPawnFunction = (doc: TextDocument, sym: PawnSymbol): void => {
  const node = sym.node;
  const kind = sym.kind;

  let completionKind: CompletionItemKind = CompletionItemKind.Function;
  if (kind === "macrodefine") completionKind = CompletionItemKind.Variable;
  if (kind === "enum") completionKind = CompletionItemKind.Enum;

  let insertText = sym.name;
  let label = sym.name;
  let params: ParameterInformation[] = [];

  // Extract documentation
  let searchNode = node;
  while (searchNode && searchNode.type !== "variable_declaration_statement" && searchNode.type !== "function_definition" && searchNode.type !== "enum_member") {
      searchNode = searchNode.parent!;
  }
  const docComment = treeSitterParser.findDocComment(searchNode || node);
  const documentation = treeSitterParser.parseXmlDoc(docComment);
  const summary = treeSitterParser.parseXmlDoc(docComment, true);

  if (node.type === "function_definition") {
    const paramsNode = node.childForFieldName("parameters");
    if (paramsNode) {
      const args = paramsNode.text.replace(/^\(|\)$/g, "");
      label = sym.name + "(" + args + ")";
      insertText = sym.name + "(" + args + ")";
      if (args.trim().length > 0) {
        params = args.split(",").map((value) => {
            const trimmed = value.trim();
            // Strip tag prefix (e.g. "Float:spawnX" -> "spawnX") and default value (e.g. "= false")
            // before matching against <param name="..."> in the XML doc
            const bareParam = trimmed.replace(/^[^:]*:/, "").replace(/\s*=.*$/, "").replace(/[&*[\]]/g, "").trim();
            const escapedParam = escapeRegExp(bareParam);
            const paramMatch = docComment.match(new RegExp(`<param name="${escapedParam}">(.*?)<\/param>`, "is"));
            const paramDoc = paramMatch ? treeSitterParser.parseXmlDoc(paramMatch[1].trim()) : undefined;
            return { 
                label: trimmed,
                documentation: paramDoc
            };
        });
      }
    }
  }

  const findSnip = pawnFuncCollection.get(sym.name);
  // Priority: native > function/forward > macro
  let shouldUpdate = true;
  if (findSnip) {
    const oldPrio = getPriority(findSnip.type);
    const newPrio = getPriority(kind as any);
    if (oldPrio > newPrio) shouldUpdate = false;
  }

  if (shouldUpdate) {
    pawnFuncCollection.set(sym.name, {
        textDocument: doc,
        completion: {
          label: label,
          kind: completionKind,
          insertText: insertText,
          documentation: documentation, 
        },
        summary: summary,
        definition: {
            uri: doc.uri,
            range: sym.selectionRange,
        },
        type: kind as any,
        params: params.length > 0 ? params : undefined,
    });
  }
};

const getPriority = (type: string): number => {
  switch (type) {
    case "native": return 4;
    case "function": return 3;
    case "forward": return 2;
    case "macrofunction": return 1;
    case "macrodefine": return 0;
    default: return 0;
  }
};

export const doDocumentSymbol = (textDocument: TextDocument): DocumentSymbol[] => {
  const symbols = treeSitterParser.extractSymbols(textDocument);
  
  const mapSymbol = (sym: PawnSymbol): DocumentSymbol => {
    let kind: SymbolKind = SymbolKind.Function;
    switch (sym.kind) {
      case "macrodefine":
        kind = SymbolKind.Constant;
        break;
      case "enum":
        kind = SymbolKind.Enum;
        break;
      case "if":
        kind = SymbolKind.Namespace;
        break;
      case "switch":
        kind = SymbolKind.Class;
        break;
      case "case":
        kind = SymbolKind.Method;
        break;
      case "repetition":
        kind = SymbolKind.Interface;
        break;
      case "state":
        kind = SymbolKind.EnumMember;
        break;
      case "statement":
        kind = SymbolKind.Namespace;
        break;
      default:
        kind = SymbolKind.Function;
        break;
    }

    return {
      name: sym.name,
      kind: kind,
      range: sym.fullRange,
      selectionRange: sym.selectionRange,
      children: sym.children ? sym.children.map(mapSymbol) : [],
    };
  };

  return symbols.map(mapSymbol);
};

export const doFoldingRange = (textDocument: TextDocument): FoldingRange[] => {
  const symbols = treeSitterParser.extractSymbols(textDocument);
  const ranges: FoldingRange[] = [];

  const visit = (sym: PawnSymbol) => {
    ranges.push({
      startLine: sym.fullRange.start.line,
      startCharacter: sym.fullRange.start.character,
      endLine: sym.fullRange.end.line,
      endCharacter: sym.fullRange.end.character,
    });
    if (sym.children) {
      for (const child of sym.children) {
        visit(child);
      }
    }
  };

  for (const sym of symbols) {
    visit(sym);
  }
  return ranges;
};

export const parseSnippets = async (textDocument: TextDocument, reset = true) => {
  const ext = path.extname(textDocument.uri);
  if (!isPawnExt(ext)) return false;
  if (reset) {
    pawnFuncCollection.forEach((value: PawnFunction, key: string) => {
      if (value.textDocument.uri === textDocument.uri) pawnFuncCollection.delete(key);
    });
    pawnWords.delete(textDocument.uri);
  }
  if (!(await isParseAllowed(textDocument))) return;

  const allowWords = (await connection.workspace.getConfiguration({
    section: "pawn.language.allowWords",
  })) as true | false | null;
  const allowCustomSnip = (await connection.workspace.getConfiguration({
    section: "pawn.language.allowCustomSnip",
  })) as true | false | null;

  // Tree-sitter extraction
  const symbols = treeSitterParser.extractSymbols(textDocument);
  for (const sym of symbols) {
    pawnSymbolToPawnFunction(textDocument, sym);
  }

  // Keep these for now until we expand the grammar
  if (allowCustomSnip) parseCustomSnip(textDocument);
  parseFuncsDefines(textDocument); // For parameterized macros

  if (allowWords) parseWords(textDocument);
};

export const doCompletion = async (params: CompletionParams) => {
  const ext = path.extname(params.textDocument.uri);
  if (!isPawnExt(ext)) return undefined;
  const comItems: CompletionItem[] = [];
  pawnFuncCollection.forEach((res) => comItems.push(res.completion));
  const findSnip = pawnWords.get(params.textDocument.uri);
  if (findSnip !== undefined) findSnip.forEach((res) => comItems.push(res));
  return comItems;
};

export const doCompletionResolve = async (item: CompletionItem) => {
  item.insertText = item.insertText?.replaceAll("\\n", "\n");
  item.insertText = item.insertText?.replaceAll("\\t", "\t");
  return item;
};

export const doHover = (document: TextDocument, position: Position): Hover | undefined => {
  const ext = path.extname(document.uri);
  if (!isPawnExt(ext)) return undefined;

  // 1. Try Tree-sitter for local/rich hover
  const treeHover = treeSitterParser.getHoverInfo(document, position);
  if (treeHover) {
      return {
          contents: {
              kind: MarkupKind.Markdown,
              value: treeHover
          }
      };
  }

  // 2. Fallback to global collection
  const cursorIndex = positionToIndex(document.getText(), position);
  const result = findIdentifierAtCursor(document.getText(), cursorIndex);
  if (result.identifier.length === 0) return undefined;
  const snip = pawnFuncCollection.get(result.identifier);
  if (snip === undefined) return undefined;
  const summary = snip.summary || (typeof snip.completion.documentation === 'string' ? snip.completion.documentation : snip.completion.documentation?.value) || "";
  const markdown: MarkupContent = {
    kind: MarkupKind.Markdown,
    value: [
      "```pawn",
      snip.completion.label !== undefined && snip.completion.label,
      "```",
      "---",
      summary,
    ].join("\n"),
  };
  return {
    contents: markdown,
  };
};

export const doSignHelp = (document: TextDocument, position: Position): SignatureHelp | undefined => {
  const ext = path.extname(document.uri);
  if (!isPawnExt(ext)) return undefined;

  // VSCode's signature help widget does not render markdown bold/code in the documentation area,
  // so strip inline markers to avoid showing ** and ` literally.
  const stripInlineMarkdown = (text: string): string =>
    text
      .replace(/\*\*([^*]+)\*\*/g, "$1")   // **bold** -> bold
      .replace(/\*([^*]+)\*/g, "$1")        // *italic* -> italic
      .replace(/`([^`]+)`/g, "$1")          // `code` -> code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [text](url) -> text

  const fullSummary = (snip: PawnFunction): string =>
    snip.summary || (typeof snip.completion.documentation === 'string' ? snip.completion.documentation : snip.completion.documentation?.value) || "";

  const buildSignatureDoc = (snip: PawnFunction, activeParamIdx: number, hasArgs: boolean): string => {
    if (!hasArgs) return stripInlineMarkdown(fullSummary(snip));
    const param = snip.params?.[activeParamIdx];
    if (param) {
      const paramDoc = typeof param.documentation === 'string' ? param.documentation : param.documentation?.value;
      if (paramDoc) {
        const label = typeof param.label === 'string' ? param.label : undefined;
        // Strip tag prefix from label for display (e.g. "Float:spawnX" -> "spawnX")
        const displayLabel = label ? label.replace(/^[^:]*:/, "").replace(/\s*=.*$/, "").trim() : undefined;
        const cleanDoc = stripInlineMarkdown(paramDoc);
        return displayLabel ? `${displayLabel} — ${cleanDoc}` : cleanDoc;
      }
    }
    return stripInlineMarkdown(fullSummary(snip));
  };

  // 1. Try Tree-sitter to find the call expression and active parameter
  const treeCall = treeSitterParser.getCallExpressionAt(document, position);
  if (treeCall) {
      const funcNameNode = treeCall.node.childForFieldName("function");
      if (funcNameNode) {
          const funcName = funcNameNode.text;
          const snip = pawnFuncCollection.get(funcName);
          if (snip) {
              return {
                activeParameter: treeCall.argIndex,
                activeSignature: 0,
                signatures: [
                  {
                    label: snip.completion.label,
                    parameters: snip.params,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: buildSignatureDoc(snip, treeCall.argIndex, treeCall.hasArgs)
                    }
                  },
                ],
              };
          }
      }
  }

  // 2. Fallback to global regex-based lookup
  const cursorIndex = positionToIndex(document.getText(), position);
  const result = findFunctionIdentifier(document.getText(), cursorIndex);
  if (result.identifier === "") return undefined;
  const snip = pawnFuncCollection.get(result.identifier);
  if (snip === undefined) return undefined;
  return {
    activeParameter: result.parameterIndex,
    activeSignature: 0,
    signatures: [
      {
        label: snip.completion.label,
        parameters: snip.params,
        documentation: {
            kind: MarkupKind.Markdown,
            value: buildSignatureDoc(snip, result.parameterIndex, true)
        }
      },
    ],
  };
};

export const doGoToDef = (document: TextDocument, position: Position) => {
  const ext = path.extname(document.uri);
  if (!isPawnExt(ext)) return undefined;

  // 1. Try Tree-sitter for local/structural definitions
  const treeResult = treeSitterParser.findDefinition(document, position);
  if (treeResult.definition) return treeResult.definition;

  // 2. Fallback to global symbol map using the identifier Tree-sitter found
  const identifier = treeResult.identifier;
  if (!identifier) {
    // Last resort: old regex-based lookup if Tree-sitter didn't find even an identifier
    const cursorIndex = positionToIndex(document.getText(), position);
    const result = findIdentifierAtCursor(document.getText(), cursorIndex);
    if (result.identifier.length === 0) return;
    const snip = pawnFuncCollection.get(result.identifier);
    return snip?.definition;
  }

  const snip = pawnFuncCollection.get(identifier);
  if (snip) {
    console.log(`doGoToDef: found global definition for "${identifier}" in collection.`);
    return snip.definition;
  }
  
  console.log(`doGoToDef: "${identifier}" not found in global collection.`);
  return undefined;
};
