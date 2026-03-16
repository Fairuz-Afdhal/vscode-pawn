import * as vscode from "vscode";
import { format } from "astyle";

interface RegexCodeFix {
  expr: RegExp;
  replacement: string;
}

const beforeFix: RegexCodeFix[] = [
  { expr: /(^[ \t]+#|^#)/gm, replacement: "//pawnd_tag_hash_$1" },
  { expr: /\f|\v|\t*(new|static|const)\s*\n\s*((.|\s)*?)\s*;/gm, replacement: "$1 $2;" },
  { expr: /case\s*(\S*)\s*:\s*(\w+\s*.*;)/gm, replacement: "case $1pawnd_switch_case_signle_line$2" },
  { expr: /extract\s*(.*)->\s*(.*?);/gm, replacement: "pawnd_sscanf_extract_$1___$2___" },
  // Tag protection: trick astyle by making it look like a typed variable
  { expr: /([A-Za-z0-9_]+)\s*:\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/gm, replacement: "/*pawnd_tag_colon_$1*/ int " },
  { expr: /([^\s:])::([^\s:])(?=(?:[^"]*"[^"]*")*[^"]*$)/gm, replacement: "$1pawnd_tag_two_semicolon$2" },
  { expr: /([^\s:])@([^\s:])(?=(?:[^"]*"[^"]*")*[^"]*$)/gm, replacement: "$1pawnd_tag_at$2" },
  { expr: /\bconst\b/gm, replacement: "pawnd_tag_const" },
  // Unique Void-Tricking for restoration
  { expr: /\bstock\b/gm, replacement: "/*pawnd_kw_stock*/ void" },
  { expr: /\bpublic\b/gm, replacement: "/*pawnd_kw_public*/ void" },
  { expr: /\bforward\b/gm, replacement: "/*pawnd_kw_forward*/ void" },
  { expr: /\bnative\b/gm, replacement: "/*pawnd_kw_native*/ void" },
  { expr: /\bhook\b/gm, replacement: "/*pawnd_kw_hook*/ void" },
];

const afterFix: RegexCodeFix[] = [
  { expr: /\bpawnd_tag_const\b/gm, replacement: "const" },
  { expr: /case(.*)pawnd_switch_case_signle_line/gm, replacement: "case$1: " },
  { expr: /pawnd_sscanf_extract_(.*?)___(.*?)___/gm, replacement: "extract $1-> $2;" },
  // Restore tags
  { expr: /\/\*pawnd_tag_colon_(.*?)\*\/\s*int\s*/gm, replacement: "$1: " },
  { expr: /pawnd_tag_two_semicolon/gm, replacement: "::" },
  { expr: /pawnd_tag_at/gm, replacement: "@" },
  { expr: />(\s+)\nhook/gm, replacement: ">\nhook" },
  { expr: /static(\s+)const/gm, replacement: "static const" },
  { expr: /\.\s\./gm, replacement: ".." },
  { expr: /^[ \t]+\/\/pawnd_tag_hash_|^\/\/pawnd_tag_hash_/gm, replacement: "" },
  { expr: /CMD(.*):\r\n(.*)\(/gim, replacement: "CMD$1:$2(" },
  { expr: /CMD(.*):\n(.*)\(/gim, replacement: "CMD$1:$2(" },
  { expr: /(static|const|new) (.*?):\s+/gm, replacement: "$1 $2:" },
  // Restore keywords
  { expr: /\/\*pawnd_kw_stock\*\/\s*void/gm, replacement: "stock" },
  { expr: /\/\*pawnd_kw_public\*\/\s*void/gm, replacement: "public" },
  { expr: /\/\*pawnd_kw_forward\*\/\s*void/gm, replacement: "forward" },
  { expr: /\/\*pawnd_kw_native\*\/\s*void/gm, replacement: "native" },
  { expr: /\/\*pawnd_kw_hook\*\/\s*void/gm, replacement: "hook" },
];

const formatPawn = async (content: string) => {
  const config = vscode.workspace.getConfiguration();
  const brace_style = config.get("pawn.language.brace_style") as "Allman" | "K&R" | "Stroustrup" | "Google" | null;

  let formattedContent = content;
  for (const element of beforeFix) {
    formattedContent = formattedContent.replace(element.expr, element.replacement);
  }

  const style = () => {
    if (brace_style === "Allman") return "allman";
    else if (brace_style === "K&R") return "kr";
    else if (brace_style === "Stroustrup") return "stroustrup";
    else if (brace_style === "Google") return "google";
    else return "allman";
  };

  const formatterConfig = [
    `--style=${style()}`,
    "--indent-switches",
    "--indent-preproc-define",
    "--indent-col1-comments",
    "--indent-preproc-block",
    "--indent-after-parens",
    "--pad-comma",
    "--pad-oper",
    "--unpad-paren",
    "--pad-header",
    "--attach-return-type",
    "--max-code-length=200", // Prevent aggressive wrapping
  ];

  formattedContent = await format(formattedContent, formatterConfig.join(" "));
  for (const element of afterFix) {
    formattedContent = formattedContent.replace(element.expr, element.replacement);
  }
  return formattedContent;
};

export const formatActiveDocument = async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const document = editor.document;
  if (document.languageId !== "pawn") return;

  const content = document.getText();
  const formattedContent = await formatPawn(content);

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(content.length)
  );

  editor.edit((editBuilder) => {
    editBuilder.replace(fullRange, formattedContent);
  });
};

const PawnDocumentFormattingEditProvider = {
  async provideDocumentFormattingEdits(document: vscode.TextDocument) {
    const edits: vscode.TextEdit[] = [];
    let content = document.getText();
    content = await formatPawn(content);
    const range = new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end);
    edits.push(new vscode.TextEdit(range, content));
    return edits;
  },
  async provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range) {
    const edits: vscode.TextEdit[] = [];
    let content = document.getText(range);
    content = await formatPawn(content);
    edits.push(new vscode.TextEdit(range, content));
    return edits;
  },
};

export default PawnDocumentFormattingEditProvider;
