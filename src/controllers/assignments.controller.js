import { supabase } from "../config/supabase.js";
import { ROLES, LEDGER_MOVE } from "../config/constants.js";
import { getAllowedBaseIds, ensureBaseAllowed } from "../utils/baseAccess.js";
import { getLedgerBalance } from "../utils/ledger.js";
import { writeAuditLog } from "../services/audit.service.js";

function normalizeItems(items, assignmentId) {
  return items.map((it) => ({
    assignment_id: assignmentId,
    equipment_type_id: it.equipment_type_id,
    quantity: Number(it.quantity),
  }));
}

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

export async function createAssignment(req, res) {
  try {
    if (![ROLES.ADMIN, ROLES.BASE_COMMANDER].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { base_id, assignee_name, assignee_ref, assigned_at, notes, items } = req.body || {};
    if (!base_id || !assignee_name || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "base_id, assignee_name, items[] required" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!ensureBaseAllowed(allowed, base_id)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    // Validate items before creating the assignment (prevents partial writes)
    const tempRows = items.map((it) => ({
      equipment_type_id: it.equipment_type_id,
      quantity: Number(it.quantity),
    }));

    if (validateItems(tempRows)) {
      return res.status(400).json({ message: "each item needs equipment_type_id and quantity > 0" });
    }

    // Stock check (ledger) - ensure base has enough for every equipment type
    const grouped = groupQtyByEquipment(tempRows);
    for (const [equipment_type_id, requiredQty] of grouped.entries()) {
      const bal = await getLedgerBalance(base_id, equipment_type_id);
      if (bal < requiredQty) {
        return res.status(400).json({
          message: "insufficient stock at base",
          detail: { equipment_type_id, required: requiredQty, available: bal },
        });
      }
    }

    // Create assignment
    const { data: assignment, error: aErr } = await supabase
      .from("assignments")
      .insert({
        base_id,
        assignee_name,
        assignee_ref: assignee_ref || null,
        assigned_at: assigned_at || new Date().toISOString(),
        notes: notes || null,
        created_by: req.user.id,
      })
      .select("*")
      .single();

    if (aErr) return res.status(500).json({ message: "db error", detail: aErr.message });

    // Insert assignment items
    const rows = normalizeItems(items, assignment.id);

    const { error: iErr } = await supabase.from("assignment_items").insert(rows);
    if (iErr) return res.status(500).json({ message: "items insert failed", detail: iErr.message });

    // Ledger: ASSIGN reduces base inventory
    const ledgerRows = rows.map((r) => ({
      base_id,
      equipment_type_id: r.equipment_type_id,
      movement_type: LEDGER_MOVE.ASSIGN,
      qty_change: -r.quantity,
      ref_type: "assignment",
      ref_id: assignment.id,
      occurred_at: assignment.assigned_at,
      created_by: req.user.id,
    }));

    const { error: lErr } = await supabase.from("inventory_ledger").insert(ledgerRows);
    if (lErr) return res.status(500).json({ message: "ledger insert failed", detail: lErr.message });

    await writeAuditLog({
      action: "ASSIGNMENT_CREATED",
      actor_id: req.user.id,
      base_id,
      entity_type: "assignment",
      entity_id: assignment.id,
      metadata: { itemsCount: rows.length },
    });

    return res.status(201).json({ data: assignment });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function listAssignments(req, res) {
  try {
    const { baseId, equipmentTypeId, from, to } = req.query;

    const allowed = await getAllowedBaseIds(req.user);
    if (allowed !== null && allowed.length === 0) return res.json({ data: [] });

    if (baseId && !ensureBaseAllowed(allowed, baseId)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    let q = supabase
      .from("assignments")
      .select("*, assignment_items(*)")
      .order("assigned_at", { ascending: false });

    if (from) q = q.gte("assigned_at", from);
    if (to) q = q.lte("assigned_at", to);

    if (baseId) q = q.eq("base_id", baseId);
    else if (allowed !== null) q = q.in("base_id", allowed);

    const { data, error } = await q;
    if (error) return res.status(500).json({ message: "db error", detail: error.message });

    const filtered = equipmentTypeId
      ? (data || []).filter((a) => (a.assignment_items || []).some((it) => it.equipment_type_id === equipmentTypeId))
      : data;

    return res.json({ data: filtered });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}
