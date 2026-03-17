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
    try {
      return this.parser.parse(document.getText()) ?? undefined;
    } catch (e) {
      console.error("TreeSitterParser: Parse failed with error:", e);
      return undefined;
    }
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
            // Find explicit visibility keyword, or default to "function"
            const visibilityNode = node.children.find(c => ["new", "stock", "public", "static", "native", "forward", "hook"].includes(c.text) || c.type === "visibility");
            const visibility = visibilityNode ? visibilityNode.text : "function";
            
            currentSymbol = {
              name: nameNode.text,
              kind: (visibility === "new" ? "function" : visibility) as PawnSymbol["kind"],
              node: node,
              fullRange: this.getNodeRange(node),
              selectionRange: this.getNodeRange(nameNode),
              children: [],
            };
          }
          break;
        }
        case "preproc_define": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            currentSymbol = {
              name: nameNode.text,
              kind: "macrodefine",
              node: node,
              fullRange: this.getNodeRange(node),
              selectionRange: this.getNodeRange(nameNode),
              children: [],
            };
          }
          break;
        }
        case "enum_declaration": {
          const nameNode = node.childForFieldName("name");
          const name = nameNode ? nameNode.text : "enum";
          currentSymbol = {
            name: name,
            kind: "enum",
            node: node,
            fullRange: this.getNodeRange(node),
            selectionRange: nameNode ? this.getNodeRange(nameNode) : this.getNodeRange(node),
            children: [],
          };
          break;
        }
        case "enum_member": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            currentSymbol = {
                name: nameNode.text,
                kind: "enum", // Or another kind if preferred
                node: node,
                fullRange: this.getNodeRange(node),
                selectionRange: this.getNodeRange(nameNode),
                children: [],
            };
          }
          break;
        }
        case "variable_declaration": {
            const nameNode = node.childForFieldName("name");
            if (nameNode && (node.parent?.type === "variable_declaration_statement" || node.parent?.type === "enum_declaration")) {
              currentSymbol = {
                name: nameNode.text,
                kind: "statement",
                node: node,
                fullRange: this.getNodeRange(node),
                selectionRange: this.getNodeRange(nameNode),
                children: [],
              };
            }
            break;
        }
        case "if_statement":
        case "for_statement":
        case "while_statement":
        case "foreach_statement":
        case "switch_statement":
        case "state_statement":
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

          // Use specific kinds for better mapping in parser.ts
          let kind: PawnSymbol["kind"] = "statement";
          if (node.type === "if_statement") kind = "if";
          else if (node.type === "switch_statement") kind = "switch";
          else if (node.type === "state_statement") kind = "state";
          else if (node.type === "case_statement" || node.type === "default_statement") kind = "case";
          else if (node.type === "for_statement" || node.type === "foreach_statement" || node.type === "while_statement" || node.type === "do_while_statement") kind = "repetition";

          // Precise selection range for case/default (up to the colon)
          let selectionEnd = { line: node.startPosition.row, character: 1000 };
          if (node.type === "case_statement" || node.type === "default_statement") {
            const colonChild = node.children.find(c => c.type === ":");
            if (colonChild) {
              selectionEnd = { line: colonChild.endPosition.row, character: colonChild.endPosition.column };
            }
          }

          currentSymbol = {
            name: name,
            kind: kind,
            node: node,
            fullRange: this.getNodeRange(node),
            selectionRange: {
              start: this.getNodeRange(node).start,
              end: selectionEnd,
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
                  kind: "if",
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

  public findDefinition(document: TextDocument, position: { line: number; character: number }): { definition?: { uri: string; range: any }; identifier?: string } {
    const tree = this.parse(document);
    if (!tree) return {};

    const offset = document.offsetAt(position);
    let node: Node | null = tree.rootNode.descendantForIndex(offset);

    console.log(`tree-sitter: findDefinition at ${position.line}:${position.character} (offset ${offset})`);

    // If it's a variable_declaration, drill down to the name
    if (node && node.type === "variable_declaration") {
      node = node.childForFieldName("name");
    }

    // If we're on a non-identifier node, check the previous character (common in LSP)
    if (node && node.type !== "identifier" && offset > 0) {
      const prevNode = tree.rootNode.descendantForIndex(offset - 1);
      if (prevNode && (prevNode.type === "identifier" || prevNode.type === "variable_declaration")) {
        console.log(`tree-sitter: found ${prevNode.type} on previous byte`);
        node = prevNode.type === "variable_declaration" ? prevNode.childForFieldName("name") : prevNode;
      }
    }

    if (!node || node.type !== "identifier") {
      console.log(`tree-sitter: no identifier found at cursor (node type: ${node?.type})`);
      return {};
    }

    const name = node.text;
    console.log(`tree-sitter: searching for definition of "${name}"`);
    let current: Node | null = node;

    while (current) {
      // Check for variables declared in blocks (compound_statement)
      if (current.type === "compound_statement") {
        const ancestor = this.findAncestorIn(node, current.children);
        if (ancestor) {
          const index = current.children.indexOf(ancestor);
          for (let i = index; i >= 0; i--) {
            const sibling = current.children[i];
            const found = this.findVarInNode(sibling, name);
            if (found) return { definition: { uri: document.uri, range: this.getNodeRange(found) }, identifier: name };
          }
        }
      }

      // Check for variables in headers (for_statement, foreach_statement)
      if (current.type === "for_statement" || current.type === "foreach_statement") {
        const found = this.findVarInNode(current, name);
        if (found) return { definition: { uri: document.uri, range: this.getNodeRange(found) }, identifier: name };
      }

      // Check parameters if inside a function_definition
      if (current.type === "function_definition") {
        const params = current.childForFieldName("parameters");
        if (params) {
          for (const param of params.children) {
            if (param.type === "parameter_declaration") {
              const paramName = param.childForFieldName("name");
              if (paramName && paramName.text === name) {
                return { definition: { uri: document.uri, range: this.getNodeRange(paramName) }, identifier: name };
              }
            }
          }
        }
      }

      current = current.parent;
    }

    return { identifier: name };
  }

  private findVarInNode(node: Node, name: string): Node | null {
    // Check if the node itself is a declaration or contains declarations
    if (node.type === "variable_declaration_statement") {
      for (const child of node.children) {
        if (child.type === "variable_declaration") {
          const varName = child.childForFieldName("name");
          if (varName && varName.text === name) return varName;
        }
      }
    }

    // For loop headers, declarations are often direct children
    for (const child of node.children) {
      if (child.type === "variable_declaration") {
        const varName = child.childForFieldName("name");
        if (varName && varName.text === name) return varName;
      }
    }
    return null;
  }

  private findAncestorIn(node: Node, list: Node[]): Node | null {
    let curr: Node | null = node;
    while (curr) {
      if (list.includes(curr)) return curr;
      curr = curr.parent;
    }
    return null;
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
  kind: "function" | "native" | "forward" | "public" | "stock" | "macrodefine" | "macrofunction" | "enum" | "statement" | "if" | "switch" | "case" | "repetition" | "state";
  node: Node;
  fullRange: any;
  selectionRange: any;
  children?: PawnSymbol[];
}

export const treeSitterParser = new TreeSitterParser();
