/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */

import Module =  require('module');
import path = require('path');
import {EnrichedFunction} from './lib/types'

/**
 * Get the exported function from the user's module
 * @param mod - The user's module
 * @return function
 */
const getUserFn = function(mod: any): Function {
  if (mod.__esModule && typeof mod.default === 'function') {
    return mod.default;
  }
  return mod;
};

/**
 * Build an enriched function - Wraps the user function to provide enhanced
 * arguments (initialized InvocationEvent, Context, and Logger). Will not wrap
 * the function if a modern salesforce-sdk is not installed.
 *
 * @param userFn - The function exported by the user.
 * @param userMod - The user's module that contains the function. Used to lookup
 *   the salesforce-sdk that may have been installed by the user.
 * @return enrichedFn - The users function, which may be wrapped.
 */
const enrichFn = function(userFn: Function, userModName: string): EnrichedFunction | Function {
  let sdk, errmsg;
  try {
    const sdkPath = path.join(userModName, 'node_modules', "@salesforce/salesforce-sdk");
    sdk = require(sdkPath);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(err);
    }
    errmsg = "@salesforce/salesforce-sdk not installed.";
  }
  if (!errmsg && typeof sdk.enrichFn !== 'function') {
    errmsg = "@salesforce/salesforce-sdk is outdated.";
  }
  if (errmsg && userFn.length === 3) {
    throw `Cannot build enriched salesforce function. ${errmsg}`;
  }
  if (errmsg) {
    console.warn(`Cannot provide enriched salesforce function arguments. ${errmsg}`);
    return userFn;
  }
  // we assume the sdk returned the correct signature
  return (<EnrichedFunction>sdk.enrichFn(userFn));
};

/**
 * Get the user's function to be called for each invocation.
 *
 * @param packageName - The name of the user's package.
 * @return function - The function to be called
 */
export default function(packageName: string): EnrichedFunction | Function {
  try {
    if (!packageName) {
      throw 'package name not defined.';
    }

    const userMod = require(packageName);
    const userFn = getUserFn(userMod);
    return enrichFn(userFn, packageName);
  } catch (err) {
    console.error(`Could not load salesforce function: ${err}`);
    process.exit(1);
  }
}
