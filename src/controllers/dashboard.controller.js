import { supabase } from "../config/supabase.js";
import { LEDGER_MOVE } from "../config/constants.js";
import { getAllowedBaseIds, ensureBaseAllowed } from "../utils/baseAccess.js";

// Utility: sum ledger qty_change for a base/equipment and optional movement types + time bounds
async function sumLedger({
  baseId,
  equipmentTypeId,
  moveTypes = null, // array of movement types OR null for all
  before = null, // occurred_at < before
  upto = null, // occurred_at <= upto
  from = null, // occurred_at >= from
  to = null, // occurred_at <= to
}) {
  let q = supabase.from("inventory_ledger").select("qty_change.sum()").eq("base_id", baseId);

  if (equipmentTypeId) q = q.eq("equipment_type_id", equipmentTypeId);
  if (Array.isArray(moveTypes) && moveTypes.length > 0) q = q.in("movement_type", moveTypes);

  if (before) q = q.lt("occurred_at", before);
  if (upto) q = q.lte("occurred_at", upto);
  if (from) q = q.gte("occurred_at", from);
  if (to) q = q.lte("occurred_at", to);

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);

  const raw = data || {};
  const val = typeof raw.sum === "number" ? raw.sum : raw?.qty_change ?? 0;
  return Number(val || 0);
}

async function sumAssignmentItems({ baseId, equipmentTypeId, from, to }) {
  let q = supabase.from("assignments").select("assignment_items(equipment_type_id, quantity)").eq("base_id", baseId);

  if (from) q = q.gte("assigned_at", from);
  if (to) q = q.lte("assigned_at", to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let total = 0;
  for (const a of data || []) {
    for (const it of a.assignment_items || []) {
      if (equipmentTypeId && it.equipment_type_id !== equipmentTypeId) continue;
      total += Number(it.quantity || 0);
    }
  }
  return total;
}

async function sumExpenditureItems({ baseId, equipmentTypeId, from, to }) {
  let q = supabase
    .from("expenditures")
    .select("expenditure_items(equipment_type_id, quantity)")
    .eq("base_id", baseId);

  if (from) q = q.gte("expended_at", from);
  if (to) q = q.lte("expended_at", to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let total = 0;
  for (const e of data || []) {
    for (const it of e.expenditure_items || []) {
      if (equipmentTypeId && it.equipment_type_id !== equipmentTypeId) continue;
      total += Number(it.quantity || 0);
    }
  }
  return total;
}

export async function dashboardSummary(req, res) {
  try {
    const { baseId, equipmentTypeId, from, to } = req.query;
    if (!baseId || !from || !to) {
      return res.status(400).json({ message: "baseId, from, to are required" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!ensureBaseAllowed(allowed, baseId)) return res.status(403).json({ message: "Forbidden: base access" });

    // Movement-only opening/closing (matches requirement formula: purchases + transferIn - transferOut)
    const movementTypes = [LEDGER_MOVE.PURCHASE, LEDGER_MOVE.TRANSFER_IN, LEDGER_MOVE.TRANSFER_OUT];
    const opening = await sumLedger({ baseId, equipmentTypeId, moveTypes: movementTypes, before: from });
    const closing = await sumLedger({ baseId, equipmentTypeId, moveTypes: movementTypes, upto: to });

    // On-hand opening/closing includes consumption (ASSIGN + EXPEND are negative in ledger)
    const onHandTypes = [...movementTypes, LEDGER_MOVE.ASSIGN, LEDGER_MOVE.EXPEND];
    const onHandOpening = await sumLedger({ baseId, equipmentTypeId, moveTypes: onHandTypes, before: from });
    const onHandClosing = await sumLedger({ baseId, equipmentTypeId, moveTypes: onHandTypes, upto: to });

    const purchases = await sumLedger({ baseId, equipmentTypeId, moveTypes: [LEDGER_MOVE.PURCHASE], from, to });
    const transferIn = await sumLedger({ baseId, equipmentTypeId, moveTypes: [LEDGER_MOVE.TRANSFER_IN], from, to });

    // TRANSFER_OUT is stored as negative qty_change in the ledger, so expose it as positive number
    const transferOutSigned = await sumLedger({ baseId, equipmentTypeId, moveTypes: [LEDGER_MOVE.TRANSFER_OUT], from, to });
    const transferOut = Math.abs(transferOutSigned);

    const assigned = await sumAssignmentItems({ baseId, equipmentTypeId, from, to });
    const expended = await sumExpenditureItems({ baseId, equipmentTypeId, from, to });

    const netMovement = purchases + transferIn - transferOut;

    return res.json({
      data: {
        // Required fields
        opening,
        closing,
        netMovement,
        purchases,
        transferIn,
        transferOut,
        assigned,
        expended,
        // Extra (useful) fields
        onHandOpening,
        onHandClosing,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function netMovementDetails(req, res) {
  try {
    const { baseId, equipmentTypeId, from, to } = req.query;
    if (!baseId || !from || !to) {
      return res.status(400).json({ message: "baseId, from, to are required" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!ensureBaseAllowed(allowed, baseId)) return res.status(403).json({ message: "Forbidden: base access" });

    const purchases = await sumLedger({ baseId, equipmentTypeId, moveTypes: [LEDGER_MOVE.PURCHASE], from, to });
    const transferIn = await sumLedger({ baseId, equipmentTypeId, moveTypes: [LEDGER_MOVE.TRANSFER_IN], from, to });
    const transferOutSigned = await sumLedger({ baseId, equipmentTypeId, moveTypes: [LEDGER_MOVE.TRANSFER_OUT], from, to });
    const transferOut = Math.abs(transferOutSigned);

    const netMovement = purchases + transferIn - transferOut;

    return res.json({ data: { netMovement, purchases, transferIn, transferOut } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}
