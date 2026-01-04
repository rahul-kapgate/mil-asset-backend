import { supabase } from "../config/supabase.js";
import { ROLES, LEDGER_MOVE } from "../config/constants.js";
import { getAllowedBaseIds, ensureBaseAllowed } from "../utils/baseAccess.js";
import { writeAuditLog } from "../services/audit.service.js";

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

    const rows = items.map((it) => ({
      expenditure_id: expenditure.id,
      equipment_type_id: it.equipment_type_id,
      quantity: Number(it.quantity),
    }));

    if (rows.some((x) => !x.equipment_type_id || !Number.isFinite(x.quantity) || x.quantity <= 0)) {
      return res.status(400).json({ message: "each item needs equipment_type_id and quantity > 0" });
    }

    const { error: iErr } = await supabase.from("expenditure_items").insert(rows);
    if (iErr) return res.status(500).json({ message: "items insert failed", detail: iErr.message });

    // Ledger only if expended directly from base (not linked to assignment)
    if (!related_assignment_id) {
      const ledgerRows = rows.map((r) => ({
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
      metadata: { related_assignment_id: related_assignment_id || null, itemsCount: rows.length },
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

    if (baseId) q = q.eq("base_id", baseId);
    else if (allowed !== null) q = q.in("base_id", allowed);

    if (from) q = q.gte("expended_at", from);
    if (to) q = q.lte("expended_at", to);

    const { data, error } = await q;
    if (error) return res.status(500).json({ message: "db error", detail: error.message });

    const filtered = equipmentTypeId
      ? data.filter((e) => (e.expenditure_items || []).some((it) => it.equipment_type_id === equipmentTypeId))
      : data;

    return res.json({ data: filtered });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

