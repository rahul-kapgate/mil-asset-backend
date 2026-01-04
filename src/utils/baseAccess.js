import { supabase } from "../config/supabase.js";
import { ROLES } from "../config/constants.js";

/**
 * returns:
 *  - null => all bases allowed (ADMIN)
 *  - [] => none allowed
 *  - [uuid, uuid] => allowed base ids
 */
export async function getAllowedBaseIds(user) {
  if (!user) return [];

  if (user.role === ROLES.ADMIN) return null;

  if (user.role === ROLES.BASE_COMMANDER) {
    return user.base_id ? [user.base_id] : [];
  }

  if (user.role === ROLES.LOGISTICS_OFFICER) {
    const { data, error } = await supabase
      .from("user_base_access")
      .select("base_id")
      .eq("user_id", user.id);

    if (!error && data && data.length) {
      return data.map((r) => r.base_id);
    }

    return user.base_id ? [user.base_id] : [];
  }

  return [];
}

export function ensureBaseAllowed(allowedBaseIds, baseId) {
  if (allowedBaseIds === null) return true; // admin
  return Array.isArray(allowedBaseIds) && allowedBaseIds.includes(baseId);
}
