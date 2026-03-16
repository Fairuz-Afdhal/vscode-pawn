import * as Parser from "web-tree-sitter";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";

export class TreeSitterParser {
  private parser: Parser | undefined;
  private language: Parser.Language | undefined;

  public async initialize() {
    await Parser.init();
    this.parser = new Parser();
    const wasmPath = path.join(__dirname, "..", "..", "dist", "tree-sitter-pawn.wasm");
    try {
      this.language = await Parser.Language.load(wasmPath);
      this.parser.setLanguage(this.language);
    } catch (e) {
      console.error("Failed to load Pawn Tree-sitter WASM:", e);
    }
  }

  public parse(document: TextDocument): Parser.Tree | undefined {
    if (!this.parser) return undefined;
    return this.parser.parse(document.getText());
  }

  public getParser(): Parser | undefined {
    return this.parser;
  }
}

export const treeSitterParser = new TreeSitterParser();
