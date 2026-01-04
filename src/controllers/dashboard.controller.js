import { supabase } from "../config/supabase.js";
import { LEDGER_MOVE } from "../config/constants.js";
import { getAllowedBaseIds, ensureBaseAllowed } from "../utils/baseAccess.js";

async function sumLedger({ baseId, equipmentTypeId, moveType, from, to, before, upto }) {
  let q = supabase.from("inventory_ledger").select("qty_change.sum()").eq("base_id", baseId);

  if (equipmentTypeId) q = q.eq("equipment_type_id", equipmentTypeId);
  if (moveType) q = q.eq("movement_type", moveType);

  if (from) q = q.gte("occurred_at", from);
  if (to) q = q.lte("occurred_at", to);

  if (before) q = q.lt("occurred_at", before);
  if (upto) q = q.lte("occurred_at", upto);

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);

  const raw = data?.sum ?? data?.["qty_change"] ?? data?.["qty_change.sum()"] ?? null;
  const val = typeof raw === "number" ? raw : raw?.qty_change ?? 0;
  return Number(val || 0);
}

async function sumAssignmentItems({ baseId, equipmentTypeId, from, to }) {
  // fetch assignments in range then sum items
  let q = supabase.from("assignments").select("id, base_id, assigned_at, assignment_items(quantity,equipment_type_id)").eq("base_id", baseId);

  if (from) q = q.gte("assigned_at", from);
  if (to) q = q.lte("assigned_at", to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let total = 0;
  for (const a of data || []) {
    for (const it of a.assignment_items || []) {
      if (!equipmentTypeId || it.equipment_type_id === equipmentTypeId) total += Number(it.quantity || 0);
    }
  }
  return total;
}

async function sumExpenditureItems({ baseId, equipmentTypeId, from, to }) {
  let q = supabase.from("expenditures").select("id, base_id, expended_at, expenditure_items(quantity,equipment_type_id)").eq("base_id", baseId);

  if (from) q = q.gte("expended_at", from);
  if (to) q = q.lte("expended_at", to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let total = 0;
  for (const e of data || []) {
    for (const it of e.expenditure_items || []) {
      if (!equipmentTypeId || it.equipment_type_id === equipmentTypeId) total += Number(it.quantity || 0);
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

    const opening = await sumLedger({ baseId, equipmentTypeId, before: from });
    const closing = await sumLedger({ baseId, equipmentTypeId, upto: to });

    const purchases = await sumLedger({ baseId, equipmentTypeId, moveType: LEDGER_MOVE.PURCHASE, from, to });
    const transferIn = await sumLedger({ baseId, equipmentTypeId, moveType: LEDGER_MOVE.TRANSFER_IN, from, to });
    const transferOut = await sumLedger({ baseId, equipmentTypeId, moveType: LEDGER_MOVE.TRANSFER_OUT, from, to });

    const assigned = await sumAssignmentItems({ baseId, equipmentTypeId, from, to });
    const expended = await sumExpenditureItems({ baseId, equipmentTypeId, from, to });

    const netMovement = purchases + transferIn - transferOut;

    return res.json({
      data: { opening, closing, netMovement, purchases, transferIn, transferOut, assigned, expended },
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

    // Purchases rows
    let pq = supabase
      .from("purchases")
      .select("*")
      .eq("base_id", baseId)
      .order("purchased_at", { ascending: false })
      .gte("purchased_at", from)
      .lte("purchased_at", to);

    if (equipmentTypeId) pq = pq.eq("equipment_type_id", equipmentTypeId);

    const { data: purchases, error: pErr } = await pq;
    if (pErr) return res.status(500).json({ message: "db error", detail: pErr.message });

    // Transfers rows (only RECEIVED) — split into IN/OUT relative to baseId
    let tq = supabase
      .from("transfers")
      .select("*, transfer_items(*)")
      .eq("status", "RECEIVED")
      .gte("received_at", from)
      .lte("received_at", to)
      .or(`from_base_id.eq.${baseId},to_base_id.eq.${baseId}`)
      .order("received_at", { ascending: false });

    const { data: transfers, error: tErr } = await tq;
    if (tErr) return res.status(500).json({ message: "db error", detail: tErr.message });

    const transfersIn = [];
    const transfersOut = [];

    for (const tr of transfers || []) {
      // optional equipment filter: keep only if any item matches
      if (equipmentTypeId) {
        const ok = (tr.transfer_items || []).some((it) => it.equipment_type_id === equipmentTypeId);
        if (!ok) continue;
      }

      if (tr.to_base_id === baseId) transfersIn.push(tr);
      if (tr.from_base_id === baseId) transfersOut.push(tr);
    }

    return res.json({ data: { purchases, transfersIn, transfersOut } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}
