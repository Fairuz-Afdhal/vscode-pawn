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

    const visit = (node: Node): PawnSymbol[] => {
      const symbols: PawnSymbol[] = [];
      let currentSymbol: PawnSymbol | undefined;

      switch (node.type) {
        case "function_definition": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            const visibility = node.child(0)?.type === "visibility" ? node.child(0)?.text : "function";
            const firstLine = node.text.split("\n")[0].trim();
            let name = firstLine;
            if (name.endsWith("{")) name = name.slice(0, -1).trim();

            currentSymbol = {
              name: name,
              kind: visibility as PawnSymbol["kind"],
              node: node,
              fullRange: this.getNodeRange(node),
              selectionRange: {
                start: this.getNodeRange(node).start,
                end: { line: node.startPosition.row, character: 1000 },
              },
              children: [],
            };
          }
          break;
        }
        case "preproc_define": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            const firstLine = node.text.split("\n")[0].trim();
            currentSymbol = {
              name: firstLine,
              kind: "macrodefine",
              node: node,
              fullRange: this.getNodeRange(node),
              selectionRange: {
                start: this.getNodeRange(node).start,
                end: { line: node.startPosition.row, character: 1000 },
              },
              children: [],
            };
          }
          break;
        }
        case "enum_declaration": {
          const firstLine = node.text.split("\n")[0].trim();
          let name = firstLine;
          if (name.endsWith("{")) name = name.slice(0, -1).trim();

          currentSymbol = {
            name: name,
            kind: "enum",
            node: node,
            fullRange: this.getNodeRange(node),
            selectionRange: {
              start: this.getNodeRange(node).start,
              end: { line: node.startPosition.row, character: 1000 },
            },
            children: [],
          };
          break;
        }
        case "if_statement":
        case "for_statement":
        case "while_statement":
        case "foreach_statement":
        case "switch_statement":
        case "do_while_statement":
        case "case_statement":
        case "default_statement": {
          const firstLine = node.text.split("\n")[0].trim();
          let name = firstLine;
          if (name.endsWith("{")) name = name.slice(0, -1).trim();

          // Handle 'else if'
          if (node.type === "if_statement" && node.parent?.type === "if_statement") {
            const siblings = node.parent.children;
            const index = siblings.indexOf(node);
            if (index > 0 && siblings[index - 1].type === "else") {
              name = "else " + name;
            }
          }

          // Fallback name if header is empty or just a brace
          if (!name || name === "{" || name === "}") {
            name = node.type.replace("_statement", "");
          }

          currentSymbol = {
            name: name,
            kind: "statement",
            node: node,
            fullRange: this.getNodeRange(node),
            selectionRange: {
              start: this.getNodeRange(node).start,
              end: { line: node.startPosition.row, character: 1000 },
            },
            children: [],
          };
          break;
        }
        case "ERROR": {
          break;
        }
      }

      if (currentSymbol) {
        symbols.push(currentSymbol);
        for (const child of node.children) {
          const childSymbols = visit(child);
          currentSymbol.children!.push(...childSymbols);
        }

        // Special handling for plain 'else' blocks (which are not if_statements)
        if (node.type === "if_statement") {
          const children = node.children;
          for (let i = 0; i < children.length; i++) {
            if (children[i].type === "else" && i + 1 < children.length) {
              const next = children[i + 1];
              if (next.type !== "if_statement") {
                const elseSymbol: PawnSymbol = {
                  name: "else",
                  kind: "statement",
                  node: next,
                  fullRange: this.getNodeRange(next),
                  selectionRange: {
                    start: { line: children[i].startPosition.row, character: children[i].startPosition.column },
                    end: { line: children[i].startPosition.row, character: 1000 },
                  },
                  children: visit(next)
                };
                currentSymbol.children!.push(elseSymbol);
              }
            }
          }
        }
      } else {
        for (const child of node.children) {
          symbols.push(...visit(child));
        }
      }

      return symbols;
    };

    return visit(tree.rootNode);
  }

  private getNodeRange(node: Node) {
    return {
      start: { line: node.startPosition.row, character: node.startPosition.column },
      end: { line: node.endPosition.row, character: node.endPosition.column },
    };
  }

  public getTree(document: TextDocument): Node | undefined {
    const tree = this.parse(document);
    return tree?.rootNode;
  }
}

export interface PawnSymbol {
  name: string;
  kind: "function" | "native" | "forward" | "public" | "stock" | "macrodefine" | "macrofunction" | "enum" | "statement";
  node: Node;
  fullRange: any;
  selectionRange: any;
  children?: PawnSymbol[];
}

export const treeSitterParser = new TreeSitterParser();
