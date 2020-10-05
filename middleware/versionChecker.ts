import * as semver from 'semver';

export default function versionsCompatible(moduleName: string, requestedVersion: string, requiredVersionRange: string): boolean {
  try {
    if (!semver.satisfies(requestedVersion, requiredVersionRange)) {
      console.warn(`WARNING: The salesforce function's installed ${moduleName} version(${requestedVersion}) is not compatible with the version required by the function engine. Please update ${moduleName} to ${requiredVersionRange}`);
      return false;
    }
  } catch (e) {
    console.warn(`WARNING: couldn't detect salesforce function's installed ${moduleName} version: ${e}`);
  }
  return true;
}
