import { supabase } from "../config/supabase.js";
import { ROLES, LEDGER_MOVE } from "../config/constants.js";
import { getAllowedBaseIds, ensureBaseAllowed } from "../utils/baseAccess.js";
import { getLedgerBalance } from "../utils/ledger.js";
import { writeAuditLog } from "../services/audit.service.js";

function validateItems(rows) {
  return rows.some((x) => !x.equipment_type_id || !Number.isFinite(x.quantity) || x.quantity <= 0);
}

function groupQtyByEquipment(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(r.equipment_type_id, (map.get(r.equipment_type_id) || 0) + r.quantity);
  }
  return map;
}

async function validateAgainstAssignment({ assignmentId, baseId, requestItems }) {
  // 1) assignment exists and belongs to baseId
  const { data: assignment, error: aErr } = await supabase
    .from("assignments")
    .select("id, base_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (aErr) return { ok: false, status: 500, body: { message: "db error", detail: aErr.message } };
  if (!assignment) return { ok: false, status: 400, body: { message: "related_assignment_id not found" } };
  if (assignment.base_id !== baseId) {
    return { ok: false, status: 400, body: { message: "base_id does not match assignment.base_id" } };
  }

  // 2) load assigned quantities
  const { data: assignedItems, error: aiErr } = await supabase
    .from("assignment_items")
    .select("equipment_type_id, quantity")
    .eq("assignment_id", assignmentId);

  if (aiErr) return { ok: false, status: 500, body: { message: "db error", detail: aiErr.message } };

  const assignedMap = new Map();
  for (const it of assignedItems || []) {
    assignedMap.set(it.equipment_type_id, Number(it.quantity));
  }

  // 3) sum already-expended quantities against this assignment
  const { data: exps, error: exErr } = await supabase
    .from("expenditures")
    .select("id, expenditure_items(equipment_type_id, quantity)")
    .eq("related_assignment_id", assignmentId);

  if (exErr) return { ok: false, status: 500, body: { message: "db error", detail: exErr.message } };

  const expendedMap = new Map();
  for (const exp of exps || []) {
    for (const it of exp.expenditure_items || []) {
      expendedMap.set(it.equipment_type_id, (expendedMap.get(it.equipment_type_id) || 0) + Number(it.quantity));
    }
  }

  // 4) enforce remaining >= request
  const reqGrouped = groupQtyByEquipment(requestItems);
  for (const [equipment_type_id, reqQty] of reqGrouped.entries()) {
    const assignedQty = assignedMap.get(equipment_type_id) || 0;
    const already = expendedMap.get(equipment_type_id) || 0;
    const remaining = assignedQty - already;

    if (assignedQty <= 0) {
      return { ok: false, status: 400, body: { message: "equipment_type_id not in assignment", detail: { equipment_type_id } } };
    }
    if (remaining < reqQty) {
      return {
        ok: false,
        status: 400,
        body: {
          message: "expenditure exceeds remaining assigned quantity",
          detail: { equipment_type_id, assigned: assignedQty, already_expended: already, remaining, requested: reqQty },
        },
      };
    }
  }

  return { ok: true };
}

export async function createExpenditure(req, res) {
  try {
    if (![ROLES.ADMIN, ROLES.BASE_COMMANDER].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { base_id, reason, related_assignment_id, expended_at, items } = req.body || {};
    if (!base_id || !reason || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "base_id, reason, items[] required" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!ensureBaseAllowed(allowed, base_id)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    const rows = items.map((it) => ({
      equipment_type_id: it.equipment_type_id,
      quantity: Number(it.quantity),
    }));

    if (validateItems(rows)) {
      return res.status(400).json({ message: "each item needs equipment_type_id and quantity > 0" });
    }

    // If linked to assignment, validate against remaining assigned quantity.
    if (related_assignment_id) {
      const check = await validateAgainstAssignment({
        assignmentId: related_assignment_id,
        baseId: base_id,
        requestItems: rows,
      });
      if (!check.ok) return res.status(check.status).json(check.body);
    } else {
      // Direct expenditure reduces base inventory, so check base stock first.
      const grouped = groupQtyByEquipment(rows);
      for (const [equipment_type_id, requiredQty] of grouped.entries()) {
        const bal = await getLedgerBalance(base_id, equipment_type_id);
        if (bal < requiredQty) {
          return res.status(400).json({
            message: "insufficient stock at base",
            detail: { equipment_type_id, required: requiredQty, available: bal },
          });
        }
      }
    }

    const { data: expenditure, error: eErr } = await supabase
      .from("expenditures")
      .insert({
        base_id,
        reason,
        related_assignment_id: related_assignment_id || null,
        expended_at: expended_at || new Date().toISOString(),
        created_by: req.user.id,
      })
      .select("*")
      .single();

    if (eErr) return res.status(500).json({ message: "db error", detail: eErr.message });

    const itemRows = items.map((it) => ({
      expenditure_id: expenditure.id,
      equipment_type_id: it.equipment_type_id,
      quantity: Number(it.quantity),
    }));

    const { error: iErr } = await supabase.from("expenditure_items").insert(itemRows);
    if (iErr) return res.status(500).json({ message: "items insert failed", detail: iErr.message });

    // Ledger only if expended directly from base (not linked to assignment)
    if (!related_assignment_id) {
      const ledgerRows = itemRows.map((r) => ({
        base_id,
        equipment_type_id: r.equipment_type_id,
        movement_type: LEDGER_MOVE.EXPEND,
        qty_change: -r.quantity,
        ref_type: "expenditure",
        ref_id: expenditure.id,
        occurred_at: expenditure.expended_at,
        created_by: req.user.id,
      }));

      const { error: lErr } = await supabase.from("inventory_ledger").insert(ledgerRows);
      if (lErr) return res.status(500).json({ message: "ledger insert failed", detail: lErr.message });
    }

    await writeAuditLog({
      action: "EXPENDITURE_CREATED",
      actor_id: req.user.id,
      base_id,
      entity_type: "expenditure",
      entity_id: expenditure.id,
      metadata: { related_assignment_id: related_assignment_id || null, itemsCount: itemRows.length },
    });

    return res.status(201).json({ data: expenditure });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function listExpenditures(req, res) {
  try {
    const { baseId, equipmentTypeId, from, to } = req.query;

    const allowed = await getAllowedBaseIds(req.user);
    if (allowed !== null && allowed.length === 0) return res.json({ data: [] });

    if (baseId && !ensureBaseAllowed(allowed, baseId)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    let q = supabase
      .from("expenditures")
      .select("*, expenditure_items(*)")
      .order("expended_at", { ascending: false });

    if (from) q = q.gte("expended_at", from);
    if (to) q = q.lte("expended_at", to);

    if (baseId) q = q.eq("base_id", baseId);
    else if (allowed !== null) q = q.in("base_id", allowed);

    const { data, error } = await q;
    if (error) return res.status(500).json({ message: "db error", detail: error.message });

    const filtered = equipmentTypeId
      ? (data || []).filter((e) => (e.expenditure_items || []).some((it) => it.equipment_type_id === equipmentTypeId))
      : data;

    return res.json({ data: filtered });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}
