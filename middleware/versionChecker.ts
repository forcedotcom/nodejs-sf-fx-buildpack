import * as semver from 'semver';

export default function versionsCompatible(moduleName: string, requestedVersion: string, requiredVersionRange: string): boolean {
  if (!semver.satisfies(requestedVersion, requiredVersionRange)) {
    console.warn(`WARNING: The salesforce function's installed ${moduleName} version(${requestedVersion}) is not compatible with the version required by the function engine. Please update ${moduleName} to ${requiredVersionRange}`);
    return false;
  }
  return true;
}
