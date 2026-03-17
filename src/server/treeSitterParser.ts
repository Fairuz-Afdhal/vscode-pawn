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

  public findDefinition(document: TextDocument, position: { line: number; character: number }): { definition?: { uri: string; range: any }; identifier?: string; node?: Node } {
    const tree = this.parse(document);
    if (!tree) return {};

    const offset = document.offsetAt(position);
    let node: Node | null = tree.rootNode.descendantForIndex(offset);

    // If it's a variable_declaration, drill down to the name
    if (node && node.type === "variable_declaration") {
      node = node.childForFieldName("name");
    }

    // If we're on a non-identifier node, check the previous character (common in LSP)
    if (node && node.type !== "identifier" && offset > 0) {
      const prevNode = tree.rootNode.descendantForIndex(offset - 1);
      if (prevNode && (prevNode.type === "identifier" || prevNode.type === "variable_declaration")) {
        node = prevNode.type === "variable_declaration" ? prevNode.childForFieldName("name") : prevNode;
      }
    }

    if (!node || node.type !== "identifier") {
      return {};
    }

    const name = node.text;
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
            if (found) return { definition: { uri: document.uri, range: this.getNodeRange(found) }, identifier: name, node: found };
          }
        }
      }

      // Check for variables in headers (for_statement, foreach_statement)
      if (current.type === "for_statement" || current.type === "foreach_statement") {
        const found = this.findVarInNode(current, name);
        if (found) return { definition: { uri: document.uri, range: this.getNodeRange(found) }, identifier: name, node: found };
      }

      // Check parameters if inside a function_definition
      if (current.type === "function_definition") {
        const params = current.childForFieldName("parameters");
        if (params) {
          for (const param of params.children) {
            if (param.type === "parameter_declaration") {
              const paramName = param.childForFieldName("name");
              if (paramName && paramName.text === name) {
                return { definition: { uri: document.uri, range: this.getNodeRange(paramName) }, identifier: name, node: paramName };
              }
            }
          }
        }
      }

      current = current.parent;
    }

    return { identifier: name };
  }

  public getHoverInfo(document: TextDocument, position: { line: number; character: number }): string | undefined {
    const { node, identifier } = this.findDefinition(document, position);
    if (!node && identifier) {
        // Fallback to global collection if Tree-sitter didn't find a local node
        // (This will be handled in parser.ts by calling pawnFuncCollection)
        return undefined;
    }

    if (!node) return undefined;

    // Get the declaration line
    let declaration = "";
    let searchNode = node;
    while (searchNode && searchNode.type !== "variable_declaration_statement" && searchNode.type !== "function_definition" && searchNode.type !== "enum_member") {
        searchNode = searchNode.parent!;
    }
    
    if (searchNode) {
        declaration = searchNode.text.split("\n")[0].trim();
    } else {
        declaration = node.text;
    }

    // Find documentation comments
    const docComment = this.findDocComment(searchNode || node);
    const markdown = this.parseXmlDoc(docComment);

    return `\`\`\`pawn\n${declaration}\n\`\`\`\n\n${markdown}`;
  }

  public getCallExpressionAt(document: TextDocument, position: { line: number; character: number }): { node: Node; argIndex: number; hasArgs: boolean } | undefined {
    const tree = this.parse(document);
    if (!tree) return undefined;

    const offset = document.offsetAt(position);
    let node: Node | null = tree.rootNode.descendantForIndex(offset);

    while (node && node.type !== "call_expression") {
        node = node.parent;
    }

    if (!node) return undefined;

    // Calculate parameter index
    const args = node.childForFieldName("arguments");
    let argIndex = 0;
    let hasArgs = false;
    if (args) {
        for (const child of args.children) {
            if (child.startIndex >= offset) break;
            if (child.type === ",") argIndex++;
        }
        // hasArgs = arguments node has children other than the parentheses
        hasArgs = args.children.some(c => c.type !== "(" && c.type !== ")" && c.type !== ",");
    }

    return { node, argIndex, hasArgs };
  }

  public findDocComment(node: Node): string {
    let current = node.previousSibling;
    const comments: string[] = [];
    let gapCount = 0;

    // We look for 'comment' nodes, but stop if we hit too many empty lines or another declaration
    while (current && (current.type === "comment" || current.type === "\n" || current.type === " ")) {
        if (current.type === "comment") {
            const text = current.text;
            // Prefer Doxygen style or specific doc markers
            if (text.startsWith("/**") || text.startsWith("///")) {
                comments.unshift(text);
                gapCount = 0; // Reset gap if we found a strong doc block
            } else {
                // For regular comments, filter out ASCII art/aesthetic noise
                const cleaned = text.replace(/\/\*|\*\/|\/\//g, "").trim();
                if (cleaned.length > 0) {
                    if (this.isNoiseComment(cleaned)) {
                        // If it's noise, we stop searching further up to avoid picking up old headers
                        break;
                    }
                    comments.unshift(text);
                }
                gapCount = 0;
            }
        } else if (current.type === "\n") {
            gapCount++;
            if (gapCount > 2) break; // More than 2 newlines (1 blank line) between docs and node is too much
        }
        current = current.previousSibling;
    }

    return comments.join("\n");
  }

  private isNoiseComment(text: string): boolean {
    const lines = text.split("\n");
    let noiseLines = 0;
    const noiseKeywords = [/8{3,}/, /adPP/, /ad8/, /MM8/, /MMM/, /_/, /-/];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        
        // Count symbols vs alphanumeric
        let symbolCount = 0;
        for (const char of trimmed) {
            if (!/[a-zA-Z0-9]/.test(char)) symbolCount++;
        }
        
        // Density check: headers/art usually have high symbol density.
        // Lowering threshold to 0.5 to be more aggressive with ASCII art.
        if (symbolCount / trimmed.length > 0.5) {
            noiseLines++;
            continue;
        }
        
        // Repeating character patterns (ASCII art blocks often use 8, #, *, etc)
        if (/(.)\1{4,}/.test(trimmed)) {
            noiseLines++;
            continue;
        }

        // Specific ASCII art keywords or patterns
        if (noiseKeywords.some(kw => kw.test(trimmed))) {
            noiseLines++;
            continue;
        }
    }
    // If more than 40% of the lines are noise, or it's a very short header-like comment
    return noiseLines > lines.length * 0.4 || (lines.length === 1 && noiseLines === 1);
  }

  public parseXmlDoc(comment: string, summaryOnly: boolean = false): string {
    if (!comment) return "";

    // Clean up comment markers and filter out noise lines
    let text = comment
        .replace(/\/\*\*|\*\/|\/\/\/|\/\//g, "")
        .split("\n")
        .map(line => line.trim().replace(/^\* /, ""))
        .filter(line => !this.isNoiseComment(line))
        .join("\n")
        .trim();

    if (summaryOnly) {
        // Strip everything that isn't the summary or remarks at the start
        let summaryText = text;
        const summaryMatch = summaryText.match(/<summary>(.*?)<\/summary>/is);
        if (summaryMatch) {
            return this.cleanProcessedText(summaryMatch[1]);
        }
        
        // If no summary, take the first part but strip all param/returns tags first
        summaryText = summaryText.replace(/<param[^>]*?>.*?<\/param>/gis, "");
        summaryText = summaryText.replace(/<returns>.*?<\/returns>/gis, "");
        summaryText = summaryText.replace(/<seealso[^>]*?\/>/gis, "");
        summaryText = summaryText.replace(/<remarks>.*?<\/remarks>/gis, "");
        
        // Strip ALL tags before finding the first paragraph for the summary
        const firstPara = summaryText.split("\n\n")[0].replace(/<[^>]*>/g, "").trim();
        return this.cleanProcessedText(firstPara.substring(0, 300));
    }

    // Map XML tags to Markdown
    // We do multiple passes for common inline tags to handle some nesting
    for (let i = 0; i < 2; i++) {
        text = text.replace(/<summary>(.*?)<\/summary>/gs, "$1\n");
        text = text.replace(/<remarks>(.*?)<\/remarks>/gs, "\n**Remarks:**\n$1\n");
        text = text.replace(/<param name="([^"]*?)">(.*?)<\/param>/gs, "\n* `@param $1` — $2");
        // Handle variations of param tags that might be unclosed or missing quotes
        text = text.replace(/<param name=([^ >]*?)>(.*?)<\/param>/gs, "\n* `@param $1` — $2");
        
        text = text.replace(/<returns>(.*?)<\/returns>/gs, "\n**Returns:**\n$1\n");
        text = text.replace(/<example>(.*?)<\/example>/gs, "\n**Example:**\n\`\`\`pawn\n$1\n\`\`\`\n");
        text = text.replace(/<value>(.*?)<\/value>/gs, "\n**Value:** $1\n");
        text = text.replace(/<attributes>(.*?)<\/attributes>/gs, "\n**Attributes:**\n$1\n");
        text = text.replace(/<seealso name="(.*?)" \/>/gs, "\n* See also: `$1`");
        text = text.replace(/<c>(.*?)<\/c>/gs, "`$1`");
        text = text.replace(/<b>(.*?)<\/b>/gs, "**$1**");
        text = text.replace(/<i>(.*?)<\/i>/gs, "*$1*");

        // Handle HTML lists
        text = text.replace(/<li>(.*?)<\/li>/gs, "\n* $1");
        text = text.replace(/<ul>(.*?)<\/ul>/gs, "$1\n");
        text = text.replace(/<ol>(.*?)<\/ol>/gs, "$1\n");

        // Handle links - Strip internal # anchors but keep text
        text = text.replace(/<a href="#[^"]*?">(.*?)<\/a>/gs, "$1");
        text = text.replace(/<a href="([^"]*?)">(.*?)<\/a>/gs, "[$2]($1)");
        
        // Fix broken protocols like https:www. (missing //)
        text = text.replace(/https:([^\/])/g, "https://$1");
    }
    
    return this.cleanProcessedText(text);
  }

  private cleanProcessedText(text: string): string {
    // Final cleaning
    text = text.replace(/<br \/>/g, "\n");
    text = text.replace(/<p\/>/g, "\n\n");
    text = text.replace(/<library>(.*?)<\/library>/gs, ""); // Usually not needed in hover

    // Strip ALL remaining XML/HTML tags to prevent leaking noise
    text = text.replace(/<[^>]*>/g, "");

    // Handle Markdown-like internal links emitted by some tools [Text](#Anchor)
    text = text.replace(/\[([^\]]*?)\]\(#[^\)]*?\)/g, "$1");

    // Remove spaces before punctuation (e.g. "**bold** ." -> "**bold**.")
    text = text.replace(/ +([.,;:!?)\]])/g, "$1");
    // Collapse multiple spaces to one
    text = text.replace(/ {2,}/g, " ");
    // Collapse multiple newlines (max 2)
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
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
