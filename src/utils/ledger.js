import { supabase } from "../config/supabase.js";

/**
 * Returns current balance for a base + equipment type using ledger sum(qty_change).
 * Throws on DB error.
 */
export async function getLedgerBalance(baseId, equipmentTypeId) {
  const { data, error } = await supabase
    .from("inventory_ledger")
    .select("qty_change.sum()")
    .eq("base_id", baseId)
    .eq("equipment_type_id", equipmentTypeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const raw = data || {};
  const val = typeof raw.sum === "number" ? raw.sum : raw?.qty_change ?? 0;
  return Number(val || 0);
}
