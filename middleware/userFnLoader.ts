/* eslint-disable @typescript-eslint/no-explicit-any */

export default function loadUserFunction(packageName: string): any {
  if (!packageName) {
    throw `Could not locate salesforce function module: package name not defined.`;
  }
  let mod;
  try {
    mod = require(packageName);
  } catch (err) {
    throw `Could not locate salesforce function module: ${err}`;
  }
  if (mod.__esModule && typeof mod.default === 'function') {
    return mod.default;
  }
  return mod;
}
