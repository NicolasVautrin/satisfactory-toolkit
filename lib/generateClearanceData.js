/**
 * Generates clearanceData.json from the Satisfactory Docs.
 *
 * Reads mClearanceData from the game's en-US.json and parses the
 * Unreal text-serialized structs into a JSON map:
 *
 *   { "Build_SmelterMk1_C": { boxes: [ { min, max, type?, relativeTransform?, excludeForSnapping? } ] } }
 *
 * Usage:
 *   node bin/lib/generateClearanceData.js
 */
const fs   = require('fs');
const path = require('path');

const DOCS_PATH = path.join(
  'C:/Program Files (x86)/Steam/steamapps/common/Satisfactory',
  'CommunityResources/Docs/en-US.json',
);
const OUTPUT_PATH = path.join(__dirname, 'clearanceData.json');

// ---------------------------------------------------------------
// UE text struct parser
// ---------------------------------------------------------------

/**
 * Tokenize an Unreal text-serialized value string.
 * Tokens: '(' ')' ',' '=' and bare words/numbers.
 */
function tokenize(str) {
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '(' || ch === ')' || ch === ',' || ch === '=') {
      tokens.push(ch);
      i++;
      continue;
    }
    // bare word / number
    let j = i;
    while (j < str.length && !'()=, \t\n\r'.includes(str[j])) j++;
    tokens.push(str.substring(i, j));
    i = j;
  }
  return tokens;
}

/**
 * Parse a token stream into a JS value.
 *
 * Grammar (simplified):
 *   value     = struct | atom
 *   struct    = '(' pair (',' pair)* ')'
 *   pair      = key '=' value
 *   atom      = number | bool | identifier
 *
 * An outer list like ((A=1),(A=2)) is parsed as an array of structs.
 */
function parse(tokens) {
  let pos = 0;

  function peek() { return tokens[pos]; }
  function eat(expected) {
    const t = tokens[pos++];
    if (expected !== undefined && t !== expected) throw new Error(`Expected '${expected}' got '${t}' at pos ${pos - 1}`);
    return t;
  }

  function parseValue() {
    if (peek() === '(') return parseStruct();
    return parseAtom();
  }

  function parseStruct() {
    eat('(');
    // Could be a struct with key=value pairs, or a nested list of structs
    // Detect: if next is '(' it's a list of structs
    if (peek() === '(') {
      const items = [];
      items.push(parseStruct());
      while (peek() === ',') { eat(','); items.push(parseStruct()); }
      eat(')');
      return items;
    }
    // key=value pairs
    const obj = {};
    parsePair(obj);
    while (peek() === ',') { eat(','); parsePair(obj); }
    eat(')');
    return obj;
  }

  function parsePair(obj) {
    const key = tokens[pos++];
    eat('=');
    obj[key] = parseValue();
  }

  function parseAtom() {
    const t = tokens[pos++];
    // number
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    // bool
    if (t === 'True') return true;
    if (t === 'False') return false;
    // identifier / enum
    return t;
  }

  const result = parseValue();
  return result;
}

function parseUEStruct(str) {
  if (!str || !str.trim()) return null;
  const tokens = tokenize(str);
  if (tokens.length === 0) return null;
  return parse(tokens);
}

// ---------------------------------------------------------------
// Transform clearance data into clean format
// ---------------------------------------------------------------

function transformBox(raw) {
  const box = {};

  if (raw.ClearanceBox) {
    const cb = raw.ClearanceBox;
    box.min = { x: cb.Min.X, y: cb.Min.Y, z: cb.Min.Z };
    box.max = { x: cb.Max.X, y: cb.Max.Y, z: cb.Max.Z };
  }

  if (raw.Type) {
    box.type = raw.Type; // CT_Soft, etc.
  }

  if (raw.RelativeTransform) {
    const rt = raw.RelativeTransform;
    box.relativeTransform = {};
    if (rt.Translation) {
      box.relativeTransform.translation = { x: rt.Translation.X, y: rt.Translation.Y, z: rt.Translation.Z };
    }
    if (rt.Rotation) {
      box.relativeTransform.rotation = { x: rt.Rotation.X, y: rt.Rotation.Y, z: rt.Rotation.Z, w: rt.Rotation.W };
    }
  }

  if (raw.ExcludeForSnapping === true) {
    box.excludeForSnapping = true;
  }

  return box;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

const buf = fs.readFileSync(DOCS_PATH);
const str = buf[0] === 0xFF || buf[0] === 0xFE
  ? buf.toString('utf16le').replace(/^\uFEFF/, '')
  : buf.toString('utf-8').replace(/^\uFEFF/, '');
const docs = JSON.parse(str);

const result = {};
let count = 0;

for (const entry of docs) {
  for (const cls of (entry.Classes || [])) {
    if (!cls.mClearanceData || !cls.mClearanceData.trim()) continue;
    if (!cls.ClassName.startsWith('Build_')) continue;

    try {
      const parsed = parseUEStruct(cls.mClearanceData);
      const rawBoxes = Array.isArray(parsed) ? parsed : [parsed];
      const boxes = rawBoxes.map(transformBox);

      result[cls.ClassName] = { boxes };
      count++;
    } catch (e) {
      console.error(`Failed to parse ${cls.ClassName}: ${e.message}`);
      console.error('  raw:', cls.mClearanceData.slice(0, 200));
    }
  }
}

// Sort keys for stable output
const sorted = {};
for (const k of Object.keys(result).sort()) {
  sorted[k] = result[k];
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Generated ${OUTPUT_PATH}`);
console.log(`${count} buildings with clearance data`);
