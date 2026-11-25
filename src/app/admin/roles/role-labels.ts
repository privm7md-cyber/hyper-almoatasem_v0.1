// Local Arabic names for the store roles.
//
// The shared dictionary owns the rule (see `roleLabel` in the terminology
// module): a known store role has a fixed Arabic name, a role the owner
// named by hand is shown as it is, and a role whose stored name is a machine
// word is called what it really is. This file only adds the search side —
// which stored role names answer to a word the operator typed.

import { ROLE_LABELS, roleLabel } from "@/lib/admin/terminology";

/** The name the operator reads for a role. */
export function roleDisplayName(name: string): string {
  return roleLabel(name);
}

/** Stored role names whose Arabic label contains the searched word. */
export function roleKeysMatching(term: string): string[] {
  return Object.entries(ROLE_LABELS)
    .filter(([, label]) => label.includes(term))
    .map(([key]) => key);
}
