/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/* eslint-disable complexity */

var acorn = require("acorn");
var sourceMap = require("source-map");
const NEWLINE_CODE = 10;

export function prettyFast(input, options) {
  return new PrettyFast(options).getPrettifiedCodeAndSourceMap(input);
}

// If any of these tokens are seen before a "[" token, we know that "[" token
// is the start of an array literal, rather than a property access.
//
// The only exception is "}", which would need to be disambiguated by
// parsing. The majority of the time, an open bracket following a closing
// curly is going to be an array literal, so we brush the complication under
// the rug, and handle the ambiguity by always assuming that it will be an
// array literal.
const PRE_ARRAY_LITERAL_TOKENS = new Set([
  "typeof",
  "void",
  "delete",
  "case",
  "do",
  "=",
  "in",
  "{",
  "*",
  "/",
  "%",
  "else",
  ";",
  "++",
  "--",
  "+",
  "-",
  "~",
  "!",
  ":",
  "?",
  ">>",
  ">>>",
  "<<",
  "||",
  "&&",
  "<",
  ">",
  "<=",
  ">=",
  "instanceof",
  "&",
  "^",
  "|",
  "==",
  "!=",
  "===",
  "!==",
  ",",
  "}",
]);

class PrettyFast {
  /**
   * @param {Object} options: Provides configurability of the pretty printing.
   * @param {String} options.url: The URL string of the ugly JS code.
   * @param {String} options.indent: The string to indent code by.
   * @param {SourceMapGenerator} options.sourceMapGenerator: An optional sourceMapGenerator
   *                             the mappings will be added to.
   * @param {Boolean} options.prefixWithNewLine: When true, the pretty printed code will start
   *                  with a line break
   * @param {Integer} options.originalStartLine: The line the passed script starts at (1-based).
   *                  This is used for inline scripts where we need to account for the lines
   *                  before the script tag
   * @param {Integer} options.originalStartColumn: The column the passed script starts at (1-based).
   *                  This is used for inline scripts where we need to account for the position
   *                  of the script tag within the line.
   * @param {Integer} options.generatedStartLine: The line where the pretty printed script
   *                  will start at (1-based). This is used for pretty printing HTML file,
   *                  where we might have handle previous inline scripts that impact the
   *                  position of this script.
   */
  constructor(options = {}) {
    // The level of indents deep we are.
    this.#indentLevel = 0;
    this.#indentChar = options.indent;

    // We will handle mappings between ugly and pretty printed code in this SourceMapGenerator.
    this.#sourceMapGenerator =
      options.sourceMapGenerator ||
      new sourceMap.SourceMapGenerator({
        file: options.url,
      });

    this.#file = options.url;
    this.#hasOriginalStartLine = "originalStartLine" in options;
    this.#hasOriginalStartColumn = "originalStartColumn" in options;
    this.#hasGeneratedStartLine = "generatedStartLine" in options;
    this.#originalStartLine = options.originalStartLine;
    this.#originalStartColumn = options.originalStartColumn;
    this.#generatedStartLine = options.generatedStartLine;
    this.#prefixWithNewLine = options.prefixWithNewLine;
  }

  /* options */
  #indentChar;
  #indentLevel;
  #file;
  #hasOriginalStartLine;
  #hasOriginalStartColumn;
  #hasGeneratedStartLine;
  #originalStartLine;
  #originalStartColumn;
  #prefixWithNewLine;
  #generatedStartLine;
  #sourceMapGenerator;

  /* internals */

  // Whether or not we added a newline on after we added the last token.
  #addedNewline = false;
  // Whether or not we added a space after we added the last token.
  #addedSpace = false;
  #currentCode = "";
  #currentLine = 1;
  #currentColumn = 0;
  // The last token we added to the pretty printed code.
  #lastToken;
  // Stack of token types/keywords that can affect whether we want to add a
  // newline or a space. We can make that decision based on what token type is
  // on the top of the stack. For example, a comma in a parameter list should
  // be followed by a space, while a comma in an object literal should be
  // followed by a newline.
  //
  // Strings that go on the stack:
  //
  //   - "{"
  //   - "("
  //   - "["
  //   - "[\n"
  //   - "do"
  //   - "?"
  //   - "switch"
  //   - "case"
  //   - "default"
  //
  // The difference between "[" and "[\n" is that "[\n" is used when we are
  // treating "[" and "]" tokens as line delimiters and should increment and
  // decrement the indent level when we find them.
  #stack = [];

  /**
   * @param {String} input: The ugly JS code we want to pretty print.
   * @returns {Object}
   *          An object with the following properties:
   *            - code: The pretty printed code string.
   *            - map: A SourceMapGenerator instance.
   */
  getPrettifiedCodeAndSourceMap(input) {
    // Add the initial new line if needed
    if (this.#prefixWithNewLine) {
      this.#write("\n");
    }

    // Pass through acorn's tokenizer and append tokens and comments into a
    // single queue to process.  For example, the source file:
    //
    //     foo
    //     // a
    //     // b
    //     bar
    //
    // After this process, tokenQueue has the following token stream:
    //
    //     [ foo, '// a', '// b', bar]
    const tokenQueue = this.#getTokens(input);

    for (let i = 0, len = tokenQueue.length; i < len; i++) {
      const token = tokenQueue[i];
      const nextToken = tokenQueue[i + 1];
      this.#handleToken(token, nextToken);

      // Acorn's tokenizer re-uses tokens, so we have to copy the last token on
      // every iteration. We follow acorn's lead here, and reuse the lastToken
      // object the same way that acorn reuses the token object. This allows us
      // to avoid allocations and minimize GC pauses.
      if (!this.#lastToken) {
        this.#lastToken = { loc: { start: {}, end: {} } };
      }
      this.#lastToken.start = token.start;
      this.#lastToken.end = token.end;
      this.#lastToken.loc.start.line = token.loc.start.line;
      this.#lastToken.loc.start.column = token.loc.start.column;
      this.#lastToken.loc.end.line = token.loc.end.line;
      this.#lastToken.loc.end.column = token.loc.end.column;
      this.#lastToken.type = token.type;
      this.#lastToken.value = token.value;
      this.#lastToken.isArrayLiteral = token.isArrayLiteral;
    }

    return { code: this.#currentCode, map: this.#sourceMapGenerator };
  }

  /**
   * Write a pretty printed string to the prettified string and for tokens, add their
   * mapping to the SourceMapGenerator.
   *
   * @param String str
   *        The string to be added to the result.
   * @param Number line
   *        The line number the string came from in the ugly source.
   * @param Number column
   *        The column number the string came from in the ugly source.
   * @param Boolean isToken
   *        Set to true when writing tokens, so we can differentiate them from the
   *        whitespace we add.
   */
  #write(str, line, column, isToken) {
    this.#currentCode += str;
    if (isToken) {
      this.#sourceMapGenerator.addMapping({
        source: this.#file,
        // We need to swap original and generated locations, as the prettified text should
        // be seen by the sourcemap service as the "original" one.
        generated: {
          // originalStartLine is 1-based, and here we just want to offset by a number of
          // lines, so we need to decrement it
          line: this.#hasOriginalStartLine
            ? line + (this.#originalStartLine - 1)
            : line,
          // We only need to adjust the column number if we're looking at the first line, to
          // account for the html text before the opening <script> tag.
          column:
            line == 1 && this.#hasOriginalStartColumn
              ? column + this.#originalStartColumn
              : column,
        },
        original: {
          // generatedStartLine is 1-based, and here we just want to offset by a number of
          // lines, so we need to decrement it.
          line: this.#hasGeneratedStartLine
            ? this.#currentLine + (this.#generatedStartLine - 1)
            : this.#currentLine,
          column: this.#currentColumn,
        },
        name: null,
      });
    }

    for (let idx = 0, length = str.length; idx < length; idx++) {
      if (str.charCodeAt(idx) === NEWLINE_CODE) {
        this.#currentLine++;
        this.#currentColumn = 0;
      } else {
        this.#currentColumn++;
      }
    }
  }

  /**
   * Add the given token to the pretty printed results.
   *
   * @param Object token
   *        The token to add.
   */
  #writeToken(token) {
    if (token.type.label == "string") {
      this.#write(
        `'${sanitize(token.value)}'`,
        token.loc.start.line,
        token.loc.start.column,
        true
      );
    } else if (token.type.label == "regexp") {
      this.#write(
        String(token.value.value),
        token.loc.start.line,
        token.loc.start.column,
        true
      );
    } else {
      let value;
      if (token.value != null) {
        value = token.value;
        if (token.type.label === "privateId") {
          value = `#${value}`;
        }
      } else {
        value = token.type.label;
      }
      this.#write(
        String(value),
        token.loc.start.line,
        token.loc.start.column,
        true
      );
    }
  }

  /**
   * Returns the tokens computed with acorn.
   *
   * @param String input
   *        The JS code we want the tokens of.
   * @returns Array<Object>
   */
  #getTokens(input) {
    const tokens = [];

    const res = acorn.tokenizer(input, {
      locations: true,
      ecmaVersion: "latest",
      onComment(block, text, start, end, startLoc, endLoc) {
        tokens.push({
          type: {},
          comment: true,
          block,
          text,
          loc: { start: startLoc, end: endLoc },
        });
      },
    });

    for (;;) {
      const token = res.getToken();
      tokens.push(token);
      if (token.type.label == "eof") {
        break;
      }
    }

    return tokens;
  }

  /**
   * Add the required whitespace before this token, whether that is a single
   * space, newline, and/or the indent on fresh lines.
   *
   * @param Object token
   *        The token we are currently handling.
   * @param {Object|undefined} nextToken
   *        The next token, might not exist if we're on the last token
   */
  #handleToken(token, nextToken) {
    if (token.comment) {
      let commentIndentLevel = this.#indentLevel;
      if (this.#lastToken?.loc?.end?.line == token.loc.start.line) {
        commentIndentLevel = 0;
        this.#write(" ");
      }
      this.#addComment(
        commentIndentLevel,
        token.block,
        token.text,
        token.loc.start.line,
        nextToken
      );
      return;
    }

    // Shorthand for token.type.keyword, so we don't have to repeatedly access
    // properties.
    const ttk = token.type.keyword;

    if (ttk && this.#lastToken?.type?.label == ".") {
      token.type = acorn.tokTypes.name;
    }

    // Shorthand for token.type.label, so we don't have to repeatedly access
    // properties.
    const ttl = token.type.label;

    if (ttl == "eof") {
      if (!this.#addedNewline) {
        this.#write("\n");
      }
      return;
    }

    token.isArrayLiteral = isArrayLiteral(token, this.#lastToken);

    if (belongsOnStack(token)) {
      if (token.isArrayLiteral) {
        this.#stack.push("[\n");
      } else {
        this.#stack.push(ttl || ttk);
      }
    }

    if (decrementsIndent(ttl, this.#stack)) {
      this.#indentLevel--;
      if (ttl == "}" && this.#stack.at(-2) == "switch") {
        this.#indentLevel--;
      }
    }

    this.#prependWhiteSpace(token);
    this.#writeToken(token);
    this.#addedSpace = false;

    // If the next token is going to be a comment starting on the same line,
    // then no need to add a new line here
    if (
      !nextToken ||
      !nextToken.comment ||
      token.loc.end.line != nextToken.loc.start.line
    ) {
      this.#maybeAppendNewline(token);
    }

    if (shouldStackPop(token, this.#stack)) {
      this.#stack.pop();
      if (ttl == "}" && this.#stack.at(-1) == "switch") {
        this.#stack.pop();
      }
    }

    if (incrementsIndent(token)) {
      this.#indentLevel++;
    }
  }

  /**
   * Add a comment to the pretty printed code.
   *
   * @param Number indentLevel
   *        The number of indents deep we are (might be different from this.#indentLevel).
   * @param Boolean block
   *        True if the comment is a multiline block style comment.
   * @param String text
   *        The text of the comment.
   * @param Number line
   *        The line number to comment appeared on.
   * @param Object nextToken
   *        The next token if any.
   */
  #addComment(indentLevel, block, text, line, nextToken) {
    const indentString = this.#indentChar.repeat(indentLevel);
    const needNewLineAfter =
      !block || !(nextToken && nextToken.loc.start.line == line);

    if (block) {
      const commentLinesText = text
        .split(new RegExp(`/\n${indentString}/`, "g"))
        .join(`\n${indentString}`);

      this.#write(
        `${indentString}/*${commentLinesText}*/${needNewLineAfter ? "\n" : " "}`
      );
    } else {
      this.#write(`${indentString}//${text}\n`);
    }

    this.#addedNewline = needNewLineAfter;
    this.#addedSpace = !needNewLineAfter;
  }

  /**
   * Add the required whitespace before this token, whether that is a single
   * space, newline, and/or the indent on fresh lines.
   *
   * @param Object token
   *        The token we are about to add to the pretty printed code.
   */
  #prependWhiteSpace(token) {
    const ttk = token.type.keyword;
    const ttl = token.type.label;
    let newlineAdded = this.#addedNewline;
    let spaceAdded = this.#addedSpace;
    const ltt = this.#lastToken?.type?.label;

    // Handle whitespace and newlines after "}" here instead of in
    // `isLineDelimiter` because it is only a line delimiter some of the
    // time. For example, we don't want to put "else if" on a new line after
    // the first if's block.
    if (this.#lastToken && ltt == "}") {
      if (
        (ttk == "while" && this.#stack.at(-1) == "do") ||
        needsSpaceBeforeClosingCurlyBracket(ttk)
      ) {
        this.#write(" ");
        spaceAdded = true;
      } else if (needsLineBreakBeforeClosingCurlyBracket(ttl)) {
        this.#write("\n");
        newlineAdded = true;
      }
    }

    if (
      (ttl == ":" && this.#stack.at(-1) == "?") ||
      (ttl == "}" && this.#stack.at(-1) == "${")
    ) {
      this.#write(" ");
      spaceAdded = true;
    }

    if (this.#lastToken && ltt != "}" && ltt != "." && ttk == "else") {
      this.#write(" ");
      spaceAdded = true;
    }

    const ensureNewline = () => {
      if (!newlineAdded) {
        this.#write("\n");
        newlineAdded = true;
      }
    };

    if (isASI(token, this.#lastToken)) {
      ensureNewline();
    }

    if (decrementsIndent(ttl, this.#stack)) {
      ensureNewline();
    }

    if (newlineAdded) {
      let indentLevel = this.#indentLevel;
      if (ttk == "case" || ttk == "default") {
        indentLevel--;
      }
      this.#write(this.#indentChar.repeat(indentLevel));
    } else if (!spaceAdded && needsSpaceAfter(token, this.#lastToken)) {
      this.#write(" ");
      spaceAdded = true;
    }
  }

  /**
   * Append the necessary whitespace to the result after we have added the given
   * token.
   *
   * @param Object token
   *        The token that was just added to the result.
   */
  #maybeAppendNewline(token) {
    if (!isLineDelimiter(token, this.#stack)) {
      this.#addedNewline = false;
      return;
    }

    this.#write("\n");
    this.#addedNewline = true;
  }
}

/**
 * Determines if we think that the given token starts an array literal.
 *
 * @param Object token
 *        The token we want to determine if it is an array literal.
 * @param Object lastToken
 *        The last token we added to the pretty printed results.
 *
 * @returns Boolean
 *          True if we believe it is an array literal, false otherwise.
 */
function isArrayLiteral(token, lastToken) {
  if (token.type.label != "[") {
    return false;
  }
  if (!lastToken) {
    return true;
  }
  if (lastToken.type.isAssign) {
    return true;
  }
  return PRE_ARRAY_LITERAL_TOKENS.has(
    lastToken.type.keyword || lastToken.type.label
  );
}

// If any of these tokens are followed by a token on a new line, we know that
// ASI cannot happen.
const PREVENT_ASI_AFTER_TOKENS = new Set([
  // Binary operators
  "*",
  "/",
  "%",
  "+",
  "-",
  "<<",
  ">>",
  ">>>",
  "<",
  ">",
  "<=",
  ">=",
  "instanceof",
  "in",
  "==",
  "!=",
  "===",
  "!==",
  "&",
  "^",
  "|",
  "&&",
  "||",
  ",",
  ".",
  "=",
  "*=",
  "/=",
  "%=",
  "+=",
  "-=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "^=",
  "|=",
  // Unary operators
  "delete",
  "void",
  "typeof",
  "~",
  "!",
  "new",
  // Function calls and grouped expressions
  "(",
]);

// If any of these tokens are on a line after the token before it, we know
// that ASI cannot happen.
const PREVENT_ASI_BEFORE_TOKENS = new Set([
  // Binary operators
  "*",
  "/",
  "%",
  "<<",
  ">>",
  ">>>",
  "<",
  ">",
  "<=",
  ">=",
  "instanceof",
  "in",
  "==",
  "!=",
  "===",
  "!==",
  "&",
  "^",
  "|",
  "&&",
  "||",
  ",",
  ".",
  "=",
  "*=",
  "/=",
  "%=",
  "+=",
  "-=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "^=",
  "|=",
  // Function calls
  "(",
]);

/**
 * Determine if a token can look like an identifier. More precisely,
 * this determines if the token may end or start with a character from
 * [A-Za-z0-9_].
 *
 * @param Object token
 *        The token we are looking at.
 *
 * @returns Boolean
 *          True if identifier-like.
 */
function isIdentifierLike(token) {
  const ttl = token.type.label;
  return (
    ttl == "name" || ttl == "num" || ttl == "privateId" || !!token.type.keyword
  );
}

/**
 * Determines if Automatic Semicolon Insertion (ASI) occurs between these
 * tokens.
 *
 * @param Object token
 *        The current token.
 * @param Object lastToken
 *        The last token we added to the pretty printed results.
 *
 * @returns Boolean
 *          True if we believe ASI occurs.
 */
function isASI(token, lastToken) {
  if (!lastToken) {
    return false;
  }
  if (token.loc.start.line === lastToken.loc.start.line) {
    return false;
  }
  if (
    lastToken.type.keyword == "return" ||
    lastToken.type.keyword == "yield" ||
    (lastToken.type.label == "name" && lastToken.value == "yield")
  ) {
    return true;
  }
  if (
    PREVENT_ASI_AFTER_TOKENS.has(lastToken.type.label || lastToken.type.keyword)
  ) {
    return false;
  }
  if (PREVENT_ASI_BEFORE_TOKENS.has(token.type.label || token.type.keyword)) {
    return false;
  }
  return true;
}

/**
 * Determine if we should add a newline after the given token.
 *
 * @param Object token
 *        The token we are looking at.
 * @param Array stack
 *        The stack of open parens/curlies/brackets/etc.
 *
 * @returns Boolean
 *          True if we should add a newline.
 */
function isLineDelimiter(token, stack) {
  if (token.isArrayLiteral) {
    return true;
  }
  const ttl = token.type.label;
  const top = stack.at(-1);
  return (
    (ttl == ";" && top != "(") ||
    ttl == "{" ||
    (ttl == "," && top != "(") ||
    (ttl == ":" && (top == "case" || top == "default"))
  );
}

/**
 * Determines if we need to add a space after the token we are about to add.
 *
 * @param Object token
 *        The token we are about to add to the pretty printed code.
 * @param Object [lastToken]
 *        Optional last token added to the pretty printed code.
 */
function needsSpaceAfter(token, lastToken) {
  if (lastToken && needsSpaceBetweenTokens(token, lastToken)) {
    return true;
  }

  if (token.type.isAssign) {
    return true;
  }
  if (token.type.binop != null && lastToken) {
    return true;
  }
  if (token.type.label == "?") {
    return true;
  }

  return false;
}

function needsSpaceBeforeLastToken(lastToken) {
  if (lastToken.type.isLoop) {
    return true;
  }
  if (lastToken.type.isAssign) {
    return true;
  }
  if (lastToken.type.binop != null) {
    return true;
  }

  const lastTokenTypeLabel = lastToken.type.label;
  if (lastTokenTypeLabel == "?") {
    return true;
  }
  if (lastTokenTypeLabel == ":") {
    return true;
  }
  if (lastTokenTypeLabel == ",") {
    return true;
  }
  if (lastTokenTypeLabel == ";") {
    return true;
  }
  if (lastTokenTypeLabel == "${") {
    return true;
  }
  return false;
}

function isBreakContinueOrReturnStatement(lastTokenKeyword) {
  return (
    lastTokenKeyword == "break" ||
    lastTokenKeyword == "continue" ||
    lastTokenKeyword == "return"
  );
}

function needsSpaceBeforeLastTokenKeywordAfterNotDot(lastTokenKeyword) {
  return (
    lastTokenKeyword != "debugger" &&
    lastTokenKeyword != "null" &&
    lastTokenKeyword != "true" &&
    lastTokenKeyword != "false" &&
    lastTokenKeyword != "this" &&
    lastTokenKeyword != "default"
  );
}

function needsSpaceBeforeClosingParen(tokenTypeLabel) {
  return (
    tokenTypeLabel != ")" &&
    tokenTypeLabel != "]" &&
    tokenTypeLabel != ";" &&
    tokenTypeLabel != "," &&
    tokenTypeLabel != "."
  );
}

/**
 * Determines if we need to add a space between the last token we added and
 * the token we are about to add.
 *
 * @param Object token
 *        The token we are about to add to the pretty printed code.
 * @param Object lastToken
 *        The last token added to the pretty printed code.
 */
function needsSpaceBetweenTokens(token, lastToken) {
  if (needsSpaceBeforeLastToken(lastToken)) {
    return true;
  }

  const ltt = lastToken.type.label;
  if (ltt == "num" && token.type.label == ".") {
    return true;
  }

  const ltk = lastToken.type.keyword;
  const ttl = token.type.label;
  if (ltk != null && ttl != ".") {
    if (isBreakContinueOrReturnStatement(ltk)) {
      return ttl != ";";
    }
    if (needsSpaceBeforeLastTokenKeywordAfterNotDot(ltk)) {
      return true;
    }
  }

  if (ltt == ")" && needsSpaceBeforeClosingParen(ttl)) {
    return true;
  }

  if (isIdentifierLike(token) && isIdentifierLike(lastToken)) {
    // We must emit a space to avoid merging the tokens.
    return true;
  }

  if (token.type.label == "{" && lastToken.type.label == "name") {
    return true;
  }

  return false;
}

function needsSpaceBeforeClosingCurlyBracket(tokenTypeKeyword) {
  return (
    tokenTypeKeyword == "else" ||
    tokenTypeKeyword == "catch" ||
    tokenTypeKeyword == "finally"
  );
}

function needsLineBreakBeforeClosingCurlyBracket(tokenTypeLabel) {
  return (
    tokenTypeLabel != "(" &&
    tokenTypeLabel != ";" &&
    tokenTypeLabel != "," &&
    tokenTypeLabel != ")" &&
    tokenTypeLabel != "." &&
    tokenTypeLabel != "template" &&
    tokenTypeLabel != "`"
  );
}

const escapeCharacters = {
  // Backslash
  "\\": "\\\\",
  // Newlines
  "\n": "\\n",
  // Carriage return
  "\r": "\\r",
  // Tab
  "\t": "\\t",
  // Vertical tab
  "\v": "\\v",
  // Form feed
  "\f": "\\f",
  // Null character
  "\0": "\\x00",
  // Line separator
  "\u2028": "\\u2028",
  // Paragraph separator
  "\u2029": "\\u2029",
  // Single quotes
  "'": "\\'",
};

// eslint-disable-next-line prefer-template
const regExpString = "(" + Object.values(escapeCharacters).join("|") + ")";
const escapeCharactersRegExp = new RegExp(regExpString, "g");

function sanitizerReplaceFunc(_, c) {
  return escapeCharacters[c];
}

/**
 * Make sure that we output the escaped character combination inside string
 * literals instead of various problematic characters.
 */
function sanitize(str) {
  return str.replace(escapeCharactersRegExp, sanitizerReplaceFunc);
}

/**
 * Returns true if the given token type belongs on the stack.
 */
function belongsOnStack(token) {
  const ttl = token.type.label;
  const ttk = token.type.keyword;
  return (
    ttl == "{" ||
    ttl == "(" ||
    ttl == "[" ||
    ttl == "?" ||
    ttl == "${" ||
    ttk == "do" ||
    ttk == "switch" ||
    ttk == "case" ||
    ttk == "default"
  );
}

/**
 * Returns true if the given token should cause us to pop the stack.
 */
function shouldStackPop(token, stack) {
  const ttl = token.type.label;
  const ttk = token.type.keyword;
  const top = stack.at(-1);
  return (
    ttl == "]" ||
    ttl == ")" ||
    ttl == "}" ||
    (ttl == ":" && (top == "case" || top == "default" || top == "?")) ||
    (ttk == "while" && top == "do")
  );
}

/**
 * Returns true if the given token type should cause us to decrement the
 * indent level.
 */
function decrementsIndent(tokenType, stack) {
  const top = stack.at(-1);
  return (
    (tokenType == "}" && top != "${") || (tokenType == "]" && top == "[\n")
  );
}

/**
 * Returns true if the given token should cause us to increment the indent
 * level.
 */
function incrementsIndent(token) {
  return (
    token.type.label == "{" ||
    token.isArrayLiteral ||
    token.type.keyword == "switch"
  );
}
