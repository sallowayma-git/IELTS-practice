(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SafeObjectLiteralParser = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_LIMITS = Object.freeze({
    maxInputLength: 1024 * 1024,
    maxDepth: 40,
    maxProperties: 5000,
    maxStringLength: 256 * 1024
  });
  function ParseError(message, index) {
    this.name = 'SafeObjectLiteralParseError';
    this.message = message + ' at index ' + index;
    this.index = index;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ParseError);
  }
  ParseError.prototype = Object.create(Error.prototype);
  ParseError.prototype.constructor = ParseError;

  function makeLimits(options) {
    options = options || {};
    var limits = {};
    Object.keys(DEFAULT_LIMITS).forEach(function (key) {
      var configured = Number(options[key]);
      limits[key] = Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : DEFAULT_LIMITS[key];
    });
    return limits;
  }

  function Parser(source, options) {
    if (typeof source !== 'string') throw new TypeError('source must be a string');
    this.source = source;
    this.length = source.length;
    this.index = 0;
    this.depth = 0;
    this.propertyCount = 0;
    this.limits = makeLimits(options);
    if (this.length > this.limits.maxInputLength) {
      throw new ParseError('input exceeds maximum length', 0);
    }
  }

  Parser.prototype.fail = function (message) {
    throw new ParseError(message, this.index);
  };

  Parser.prototype.skipSpace = function () {
    while (this.index < this.length) {
      var ch = this.source.charAt(this.index);
      if (/\s/.test(ch)) {
        this.index++;
        continue;
      }
      if (ch === '/' && this.source.charAt(this.index + 1) === '/') {
        this.index += 2;
        while (this.index < this.length && !/[\r\n]/.test(this.source.charAt(this.index))) {
          this.index++;
        }
        continue;
      }
      if (ch === '/' && this.source.charAt(this.index + 1) === '*') {
        var end = this.source.indexOf('*/', this.index + 2);
        if (end < 0) this.fail('unterminated block comment');
        this.index = end + 2;
        continue;
      }
      break;
    }
  };

  Parser.prototype.enter = function () {
    this.depth++;
    if (this.depth > this.limits.maxDepth) this.fail('maximum nesting depth exceeded');
  };

  Parser.prototype.leave = function () {
    this.depth--;
  };

  Parser.prototype.countProperty = function () {
    this.propertyCount++;
    if (this.propertyCount > this.limits.maxProperties) {
      this.fail('maximum property count exceeded');
    }
  };

  Parser.prototype.parseString = function () {
    var quote = this.source.charAt(this.index++);
    var result = '';
    while (this.index < this.length) {
      var ch = this.source.charAt(this.index++);
      if (ch === quote) return result;
      if (ch === '\r' || ch === '\n') this.fail('unescaped newline in string');
      if (ch !== '\\') {
        result += ch;
      } else {
        if (this.index >= this.length) this.fail('unterminated string escape');
        var escape = this.source.charAt(this.index++);
        var simple = {
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
          v: '\v',
          '0': '\0',
          '\\': '\\',
          '/': '/',
          '"': '"',
          "'": "'"
        };
        if (Object.prototype.hasOwnProperty.call(simple, escape)) {
          if (escape === '0' && /[0-9]/.test(this.source.charAt(this.index))) {
            this.fail('legacy octal escapes are not supported');
          }
          result += simple[escape];
        } else if (escape === 'x') {
          var hex = this.source.slice(this.index, this.index + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.fail('invalid hex escape');
          result += String.fromCharCode(parseInt(hex, 16));
          this.index += 2;
        } else if (escape === 'u') {
          var unicode = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(unicode)) this.fail('invalid unicode escape');
          result += String.fromCharCode(parseInt(unicode, 16));
          this.index += 4;
        } else {
          this.fail('unsupported string escape');
        }
      }
      if (result.length > this.limits.maxStringLength) {
        this.fail('string exceeds maximum length');
      }
    }
    this.fail('unterminated string');
  };

  Parser.prototype.parseNumber = function () {
    var remaining = this.source.slice(this.index);
    var match = remaining.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) this.fail('invalid number');
    var next = remaining.charAt(match[0].length);
    if (next && /[A-Za-z0-9_$\.]/.test(next)) this.fail('invalid number suffix');
    this.index += match[0].length;
    var value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail('non-finite numbers are not supported');
    return value;
  };

  Parser.prototype.parseIdentifier = function () {
    var match = this.source.slice(this.index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!match) this.fail('expected identifier');
    this.index += match[0].length;
    return match[0];
  };

  Parser.prototype.parseKey = function () {
    this.skipSpace();
    var ch = this.source.charAt(this.index);
    var key;
    if (ch === '"' || ch === "'") {
      key = this.parseString();
    } else if (/[A-Za-z_$]/.test(ch)) {
      key = this.parseIdentifier();
    } else {
      var match = this.source.slice(this.index).match(/^(?:0|[1-9]\d*)/);
      if (!match) this.fail('object keys must be quoted strings, identifiers, or integers');
      key = match[0];
      this.index += match[0].length;
    }
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      this.fail('forbidden object key "' + key + '"');
    }
    return key;
  };

  Parser.prototype.parseObject = function () {
    var result = Object.create(null);
    this.index++;
    this.enter();
    this.skipSpace();
    if (this.source.charAt(this.index) === '}') {
      this.index++;
      this.leave();
      return result;
    }
    while (this.index < this.length) {
      var key = this.parseKey();
      this.countProperty();
      this.skipSpace();
      if (this.source.charAt(this.index) !== ':') {
        this.fail('object properties require a colon');
      }
      this.index++;
      result[key] = this.parseValue();
      this.skipSpace();
      var ch = this.source.charAt(this.index);
      if (ch === '}') {
        this.index++;
        this.leave();
        return result;
      }
      if (ch !== ',') this.fail('expected comma or closing brace');
      this.index++;
      this.skipSpace();
      if (this.source.charAt(this.index) === '}') {
        this.index++;
        this.leave();
        return result;
      }
    }
    this.fail('unterminated object');
  };

  Parser.prototype.parseArray = function () {
    var result = [];
    this.index++;
    this.enter();
    this.skipSpace();
    if (this.source.charAt(this.index) === ']') {
      this.index++;
      this.leave();
      return result;
    }
    while (this.index < this.length) {
      this.countProperty();
      result.push(this.parseValue());
      this.skipSpace();
      var ch = this.source.charAt(this.index);
      if (ch === ']') {
        this.index++;
        this.leave();
        return result;
      }
      if (ch !== ',') this.fail('expected comma or closing bracket');
      this.index++;
      this.skipSpace();
      if (this.source.charAt(this.index) === ']') {
        this.index++;
        this.leave();
        return result;
      }
    }
    this.fail('unterminated array');
  };

  Parser.prototype.parseValue = function () {
    this.skipSpace();
    var ch = this.source.charAt(this.index);
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"' || ch === "'") return this.parseString();
    if (ch === '-' || /[0-9]/.test(ch)) return this.parseNumber();
    if (/[A-Za-z_$]/.test(ch)) {
      var identifier = this.parseIdentifier();
      if (identifier === 'true') return true;
      if (identifier === 'false') return false;
      if (identifier === 'null') return null;
      this.fail('unsupported value "' + identifier + '"');
    }
    this.fail('unsupported value');
  };

  function parseAt(source, startIndex, options) {
    var parser = new Parser(source, options);
    parser.index = Math.max(0, Number(startIndex) || 0);
    parser.skipSpace();
    if (parser.source.charAt(parser.index) !== '{') {
      parser.fail('expected object literal');
    }
    var value = parser.parseObject();
    return { value: value, endIndex: parser.index };
  }

  function parse(source, options) {
    var parsed = parseAt(source, 0, options);
    var parser = new Parser(source, options);
    parser.index = parsed.endIndex;
    parser.skipSpace();
    if (parser.index !== parser.length) parser.fail('unexpected trailing input');
    return parsed.value;
  }

  return Object.freeze({
    ParseError: ParseError,
    parse: parse,
    parseAt: parseAt
  });
});
