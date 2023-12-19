import axios from 'axios';
import fs from 'fs-extra';

const NATIVEDB_URL = 'https://natives.altv.mp/natives';
const NATIVEDB_CACHE_FILE = './natives.json';
const NATIVEDB_CACHE_OLD_FILE = './natives.release-old.json';

const V1_TYPINGS = process.argv.includes('--v1');

const transformedNativeTypes = {
  Hash: 'number',
  int: 'number',
  float: 'number',
  FireId: 'number',
  Any: 'any',
  ScrHandle: 'number',
  Interior: 'number',
  Cam: "number",
  FireId: "number",
  Pickup: "number",
  // NOTE (xLuxy): Player might be wrong for some natives - majority should work?
  Ped: "Ped | Player | number",
  Player: "Player | number",
  Vehicle: "Vehicle | number",
  Entity: "Entity | number",
  Blip: 'number'
};

function convertSnakeToLowerCamelCase(input) {
  if (input.startsWith('_')) {
    input = input.slice(1);
  }

  const words = input.toLowerCase().split('_');
  let result = words[0];

  for (let i = 1; i < words.length; i++) {
    result += words[i].charAt(0).toUpperCase() + words[i].slice(1);
  }

  return result;
}

function transformNativeType(type) {
  return transformedNativeTypes[type] || type;
}

function convertToBlockComment(inputString) {
  const lines = inputString.split('\n').filter((line) => line.trim().length > 0);
  const indentedLines = lines.map((line, index) => {
    if (index === 0) {
      return '  /**\n   * ' + line;
    } else {
      line = line.replace(/\*\//g, '*\\/');
      return '   * ' + line;
    }
  });
  indentedLines.push('   */');
  return indentedLines.join('\n');
}

async function getOrCacheNativeDbJson() {
  if (!fs.existsSync(NATIVEDB_CACHE_FILE)) {
    const response = await getNativeDbJson();
    fs.writeFileSync(NATIVEDB_CACHE_FILE, JSON.stringify(response.data));
  }
  return fs.readFileSync(NATIVEDB_CACHE_FILE, 'utf8');
}

function getOldNativesNames() {
  if (!fs.existsSync(NATIVEDB_CACHE_OLD_FILE)) {
    return [];
  }

  const fileContent = fs.readFileSync(NATIVEDB_CACHE_OLD_FILE, 'utf8');
  const json = JSON.parse(fileContent);

  const nativesNameList = [];

  for (const natives of Object.values(json)) {
    for (const native of Object.values(natives)) {
      const nativeName = convertSnakeToLowerCamelCase(native.name);

      nativesNameList.push(nativeName);
    }
  }

  return nativesNameList;
}

async function getNativeDbJson() {
  const response = await axios.get(NATIVEDB_URL);
  return response.data;
}

function transformNativeParams(params) {
  return params.reduceRight(({ args, canBeOptional }, param) => {
    const isOptional = param.ref && canBeOptional;
    const arg = `${param.name}${isOptional ? '?' : ''}: ${transformNativeType(param.type)}`;
    return { args: [arg, ...args], canBeOptional: canBeOptional ? param.ref : false };
  }, { args: [], canBeOptional: true }).args;
}

async function main() {
  const content = await getOrCacheNativeDbJson();
  const prevNatives = getOldNativesNames();

  const json = JSON.parse(content);

  const nativesList = [];
  const nativesNameList = [];

  for (const natives of Object.values(json)) {
    for (const native of Object.values(natives)) {
      const nativeName = convertSnakeToLowerCamelCase(native.name);
      nativesNameList.push(nativeName);

      const { params, results, comment } = native;

      let transformedResult = results.replace(/^\[(.*)\]$/, '$1').split(', ').map((value) => transformNativeType(value));
      if (transformedResult[0] === 'void' && !V1_TYPINGS) transformedResult.shift();

      const resultStr = transformedResult.length > 1 ? `[${transformedResult.join(', ')}]` : transformedResult[0] || 'void';
      const functionSignature = `  export function ${nativeName}(${transformNativeParams(params).join(', ')}): ${resultStr};`;

      if (comment.trim?.().length > 0) {
        const commentBlock = convertToBlockComment(comment);
        nativesList.push(`${commentBlock}\n${functionSignature}`);
      } else {
        nativesList.push(`${functionSignature}`);
      }
    }
  }

  const newNatives = nativesNameList.filter((native) => !prevNatives.includes(native));

  console.log(`Total natives count: ${nativesList.length} (${newNatives.length} new natives):`);
  console.log(newNatives);

  let fileContent = '// This file was generated on ' + new Date().toLocaleString() + ' - DO NOT MODIFY MANUALLY\n\n';

  if (V1_TYPINGS) {
    fileContent += `/// <reference types="@altv/types-client"/>\n
/**
 * @module natives
 */
declare module "natives" {
  import { Vector3, Entity, Vehicle, Player, Ped } from "alt-client";
  export function toggleStrictChecks(enable: boolean): void;\n
`;
  } else {
    fileContent += `/// <reference types="@altv/client" />\n
/**
 * @module @altv/natives
 */
declare module "@altv/natives" {
  import { Entity, Player, Ped, Vector3, Vehicle } from "@altv/client";\n
`;
  }

  fileContent += nativesList.join('\n\n') + `\n}\n`;

  fs.outputFile('./dist/index.d.ts', fileContent, { encoding: 'utf8' });
}

main();
