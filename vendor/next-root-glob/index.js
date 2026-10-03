import { isAbsolute } from "node:path";
import { expand } from "brace-expansion";
import { globSync as matchDirectories } from "tinyglobby";

// Only Next's getRootDirs caller is overridden, not the general fast-glob API.
export function globSync(pattern, options) {
  if (typeof pattern !== "string" || options?.onlyDirectories !== true
    || Object.keys(options).some(key => key !== "onlyDirectories")) {
    throw new TypeError("Unsupported Next root-directory glob call");
  }
  return matchDirectories(expand(pattern), {
    onlyDirectories: true, expandDirectories: false, absolute: isAbsolute(pattern),
  }).map(directory => directory.length > 1 ? directory.replace(/\/$/, "") : directory);
}
