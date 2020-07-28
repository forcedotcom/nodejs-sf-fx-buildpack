/* eslint-disable @typescript-eslint/no-explicit-any */
import * as path from "path";

export default function loadUserFunction(): any {
  const functionPath = process.env.USER_FUNCTION_URI || '/workspace';
  const pjsonPath = path.join(functionPath, 'package.json');
  let main = '';
  try {
    main = require(pjsonPath).main;
  } catch (e) {
    throw `Could not read package.json: ${e}`;
  }
  const mainPath = path.join(functionPath, main);
  let mod;
  try {
    mod = require(mainPath);
  } catch (e) {
    throw `Could not locate user function: ${e}`;
  }
  if (mod.__esModule && typeof mod.default === 'function') {
    return mod.default;
  }
  return mod;
}
