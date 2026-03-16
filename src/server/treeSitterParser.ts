import { Parser, Language, Tree, Node } from "web-tree-sitter";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";

export class TreeSitterParser {
  private parser: Parser | undefined;
  private language: Language | undefined;

  public async initialize() {
    console.log("Initializing Tree-sitter parser...");
    try {
      if (typeof (Parser as any).init === 'function') {
        await (Parser as any).init();
      } else {
        console.warn("Parser.init is not a function at runtime. Checking for alternatives...");
        // Fallback for some environments
        if (typeof (Parser as any).default?.init === 'function') {
           await (Parser as any).default.init();
        }
      }
      
      this.parser = new Parser();
      const wasmPath = path.join(__dirname, "..", "..", "dist", "tree-sitter-pawn.wasm");
      this.language = await Language.load(wasmPath);
      this.parser.setLanguage(this.language);
      console.log("Pawn Tree-sitter parser initialized successfully.");
    } catch (e) {
      console.error("Failed to initialize Tree-sitter parser:", e);
    }
  }

  public parse(document: TextDocument): Tree | undefined {
    if (!this.parser) return undefined;
    return this.parser.parse(document.getText()) ?? undefined;
  }

  public getParser(): Parser | undefined {
    return this.parser;
  }

  public extractSymbols(document: TextDocument): PawnSymbol[] {
    const tree = this.parse(document);
    if (!tree) return [];

    const symbols: PawnSymbol[] = [];

    const visit = (node: Node) => {
      switch (node.type) {
        case "function_definition": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            const visibility = node.child(0)?.type === "visibility" ? node.child(0)?.text : "function";
            symbols.push({
              name: nameNode.text,
              kind: visibility as PawnSymbol["kind"],
              node: node,
              location: this.getNodeLocation(document, nameNode),
            });
          }
          break;
        }
        case "preproc_define": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            symbols.push({
              name: nameNode.text,
              kind: "macrodefine",
              node: node,
              location: this.getNodeLocation(document, nameNode),
            });
          }
          break;
        }
        case "enum_declaration": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            symbols.push({
              name: nameNode.text,
              kind: "enum",
              node: node,
              location: this.getNodeLocation(document, nameNode),
            });
          }
          break;
        }
      }

      for (const child of node.children) {
        visit(child);
      }
    };

    visit(tree.rootNode);
    return symbols;
  }

  private getNodeLocation(document: TextDocument, node: Node) {
    return {
      uri: document.uri,
      range: {
        start: { line: node.startPosition.row, character: node.startPosition.column },
        end: { line: node.endPosition.row, character: node.endPosition.column },
      },
    };
  }
}

export interface PawnSymbol {
  name: string;
  kind: "function" | "native" | "forward" | "public" | "stock" | "macrodefine" | "macrofunction" | "enum";
  node: Node;
  location: any;
}

export const treeSitterParser = new TreeSitterParser();
