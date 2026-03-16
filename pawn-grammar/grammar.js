const PREC = {
  ASSIGNMENT: -1,
  DEFAULT: 0,
  TERNARY: 1,
  LOGICAL_OR: 2,
  LOGICAL_AND: 3,
  INCLUSIVE_OR: 4,
  EXCLUSIVE_OR: 5,
  BITWISE_AND: 6,
  EQUAL: 7,
  RELATIONAL: 8,
  SHIFT: 10,
  ADD: 11,
  MULTIPLY: 12,
  UNARY: 14,
  POSTFIX: 15,
  CALL: 16,
  FIELD: 17,
};

module.exports = grammar({
  name: "pawn",

  extras: ($) => [
    /\s/,
    $.comment,
  ],

  conflicts: ($) => [
    [$.visibility, $.variable_declaration_statement],
    [$.return_statement],
    [$.string_literal],
    [$.variable_declaration_statement],
  ],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat($._definition),

    _definition: ($) => choice(
      $.function_definition,
      $.variable_declaration_statement,
      $.enum_declaration,
      $.preproc_directive,
    ),

    // Preprocessor
    preproc_directive: ($) => choice(
      $.preproc_include,
      $.preproc_define,
      $.preproc_undef,
      $.preproc_if,
      $.preproc_else,
      $.preproc_endif,
      $.preproc_pragma,
    ),

    preproc_include: ($) => seq(
      "#include",
      field("path", choice($.string_literal, $.system_lib_string)),
    ),

    preproc_define: ($) => seq(
      "#define",
      field("name", $.identifier),
      optional(field("value", $.preproc_arg)),
    ),

    preproc_undef: ($) => seq("#undef", $.identifier),
    preproc_if: ($) => seq("#if", $.preproc_arg),
    preproc_else: ($) => "#else",
    preproc_endif: ($) => "#endif",
    preproc_pragma: ($) => seq("#pragma", $.preproc_arg),

    preproc_arg: ($) => /.+/,

    system_lib_string: ($) => /<[^>]+>/,

    // Functions
    function_definition: ($) => seq(
      optional($.visibility),
      optional($._type),
      field("name", $.identifier),
      field("parameters", $.parameter_declarations),
      choice(
        field("body", $.block),
        ";"
      ),
    ),

    visibility: ($) => choice("stock", "public", "static", "native", "forward"),

    parameter_declarations: ($) => seq(
      "(",
      commaSep($.parameter_declaration),
      ")",
    ),

    parameter_declaration: ($) => seq(
      optional("const"),
      optional("&"),
      optional($._type),
      field("name", $.identifier),
      optional($.array_dimension),
      optional(seq("=", $._expression)),
    ),

    // Variables
    variable_declaration_statement: ($) => seq(
      choice("new", "static", "const"),
      commaSep1($.variable_declaration),
      optional(";"),
    ),

    variable_declaration: ($) => seq(
      optional($._type),
      field("name", $.identifier),
      optional($.array_dimension),
      optional(seq("=", $._expression)),
    ),

    array_dimension: ($) => repeat1(seq("[", optional($._expression), "]")),

    enum_declaration: ($) => seq(
      "enum",
      optional(field("name", $.identifier)),
      optional(seq("(", choice("+=", "*=", "<<="), $._expression, ")")),
      "{",
      commaSep($.enum_member),
      "}",
    ),

    enum_member: ($) => seq(
      optional($._type),
      field("name", $.identifier),
      optional(seq("[", $._expression, "]")),
      optional(seq("=", $._expression)),
    ),

    // Types / Tags
    _type: ($) => seq($.identifier, ":"),

    // Statements
    block: ($) => seq(
      "{",
      repeat($._statement),
      "}",
    ),

    _statement: ($) => choice(
      $.block,
      $.variable_declaration_statement,
      $.expression_statement,
      $.if_statement,
      $.while_statement,
      $.for_statement,
      $.return_statement,
      $.switch_statement,
      $.do_while_statement,
      $.assert_statement,
      $.break_statement,
      $.continue_statement,
      $.goto_statement,
    ),

    expression_statement: ($) => seq($._expression, optional(";")),

    if_statement: ($) => prec.right(seq(
      "if",
      "(", $._expression, ")",
      $._statement,
      optional(seq("else", $._statement)),
    )),

    while_statement: ($) => seq(
      "while",
      "(", $._expression, ")",
      $._statement,
    ),

    for_statement: ($) => seq(
      "for",
      "(",
      optional(choice($.variable_declaration_statement, $._expression)), ";",
      optional($._expression), ";",
      optional($._expression),
      ")",
      $._statement,
    ),

    return_statement: ($) => seq("return", optional($._expression), optional(";")),

    switch_statement: ($) => seq(
      "switch",
      "(", $._expression, ")",
      "{",
      repeat($._switch_case),
      "}",
    ),

    _switch_case: ($) => choice($.case_statement, $.default_statement),

    case_statement: ($) => seq(
      "case",
      commaSep1($._expression),
      ":",
      repeat($._statement),
    ),

    default_statement: ($) => seq(
      "default",
      ":",
      repeat($._statement),
    ),

    do_while_statement: ($) => seq(
      "do",
      $._statement,
      "while",
      "(", $._expression, ")",
      optional(";"),
    ),

    assert_statement: ($) => seq("assert", $._expression, optional(";")),
    break_statement: ($) => seq("break", optional(";")),
    continue_statement: ($) => seq("continue", optional(";")),
    goto_statement: ($) => seq("goto", $.identifier, optional(";")),

    // Expressions
    _expression: ($) => choice(
      $.identifier,
      $.number_literal,
      $.string_literal,
      $.assignment_expression,
      $.binary_expression,
      $.unary_expression,
      $.call_expression,
      $.parenthesized_expression,
      $.sizeof_expression,
      $.tagof_expression,
      $.defined_expression,
    ),

    sizeof_expression: ($) => seq("sizeof", choice($.identifier, $.parenthesized_expression)),
    tagof_expression: ($) => seq("tagof", choice($.identifier, $.parenthesized_expression)),
    defined_expression: ($) => seq("defined", $.identifier),

    assignment_expression: ($) => prec.right(PREC.ASSIGNMENT, seq(
      $._expression,
      choice("=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "^=", "|="),
      $._expression,
    )),

    binary_expression: ($) => {
      const table = [
        [PREC.LOGICAL_OR, "||"],
        [PREC.LOGICAL_AND, "&&"],
        [PREC.INCLUSIVE_OR, "|"],
        [PREC.EXCLUSIVE_OR, "^"],
        [PREC.BITWISE_AND, "&"],
        [PREC.EQUAL, choice("==", "!=")],
        [PREC.RELATIONAL, choice("<", ">", "<=", ">=")],
        [PREC.SHIFT, choice("<<", ">>")],
        [PREC.ADD, choice("+", "-")],
        [PREC.MULTIPLY, choice("*", "/", "%")],
      ];
      return choice(...table.map(([p, op]) => prec.left(p, seq($._expression, op, $._expression))));
    },

    unary_expression: ($) => choice(
      prec(PREC.UNARY, seq(choice("!", "~", "-", "++", "--"), $._expression)),
      prec(PREC.POSTFIX, seq($._expression, choice("++", "--", "char"))),
    ),

    call_expression: ($) => prec(PREC.CALL, seq(
      field("function", $.identifier),
      field("arguments", $.call_arguments),
    )),

    call_arguments: ($) => seq(
      "(",
      commaSep($._expression),
      ")",
    ),

    parenthesized_expression: ($) => seq("(", $._expression, ")"),

    // Literals
    identifier: ($) => /[a-zA-Z_@][a-zA-Z0-9_@]*/,

    number_literal: ($) => choice(
      /\d+/,
      /0x[0-9a-fA-F]+/,
      /0b[01]+/,
      /\d+\.\d+/,
    ),

    string_literal: ($) => choice(
      seq(
        optional("!"),
        '"',
        repeat(choice(/[^"\\\n]+/, $.escape_sequence)),
        '"',
      ),
      // Plain strings (escapes ignored)
      seq(
        optional("!"),
        "\\",
        '"',
        repeat(/[^"\n]+/),
        '"',
      ),
    ),

    escape_sequence: ($) => /\\[abfnrtv\\'"]/,

    comment: ($) => choice(
      seq("//", /[^\n]*/),
      seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/"),
    ),
  },
});

function commaSep(rule) {
  return optional(commaSep1(rule));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}
