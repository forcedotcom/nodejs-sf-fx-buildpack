/* eslint-disable @typescript-eslint/no-explicit-any */

export default function loadUserFunction(): any {
  const packageName = process.env["SF_FUNCTION_PACKAGE_NAME"];
  if (!packageName) {
    console.dir(process.env);
    throw `Could not locate function module, $SF_FUNCTION_PACKAGE_NAME not defined.`;
  }
  let mod;
  try {
    mod = require(packageName);
  } catch (err) {
    throw `Could not locate function module: ${err}`;
  }
  if (mod.__esModule && typeof mod.default === 'function') {
    return mod.default;
  }
  return mod;
}
