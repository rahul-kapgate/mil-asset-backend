import { supabase } from "../config/supabase.js";
import { ROLES, LEDGER_MOVE } from "../config/constants.js";
import { getAllowedBaseIds, ensureBaseAllowed } from "../utils/baseAccess.js";
import { writeAuditLog } from "../services/audit.service.js";

export async function createPurchase(req, res) {
  try {
    const { base_id, equipment_type_id, quantity, purchased_at, vendor, reference } = req.body || {};
    if (!base_id || !equipment_type_id || !quantity) {
      return res.status(400).json({ message: "base_id, equipment_type_id, quantity are required" });
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: "quantity must be > 0" });

    // RBAC: Admin + Logistics + (optional) Commander
    if (![ROLES.ADMIN, ROLES.LOGISTICS_OFFICER, ROLES.BASE_COMMANDER].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!ensureBaseAllowed(allowed, base_id)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    // Insert purchase
    const { data: purchase, error: pErr } = await supabase
      .from("purchases")
      .insert({
        base_id,
        equipment_type_id,
        quantity: qty,
        purchased_at: purchased_at || new Date().toISOString(),
        vendor: vendor || null,
        reference: reference || null,
        created_by: req.user.id,
      })
      .select("*")
      .single();

    if (pErr) return res.status(500).json({ message: "db error", detail: pErr.message });

    // Insert ledger (+qty)
    const { error: lErr } = await supabase.from("inventory_ledger").insert({
      base_id,
      equipment_type_id,
      movement_type: LEDGER_MOVE.PURCHASE,
      qty_change: qty,
      ref_type: "purchase",
      ref_id: purchase.id,
      occurred_at: purchase.purchased_at,
      created_by: req.user.id,
    });

    if (lErr) return res.status(500).json({ message: "ledger insert failed", detail: lErr.message });

    await writeAuditLog({
      action: "PURCHASE_CREATED",
      actor_id: req.user.id,
      base_id,
      entity_type: "purchase",
      entity_id: purchase.id,
      metadata: { quantity: qty, equipment_type_id },
    });

    return res.status(201).json({ data: purchase });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function listPurchases(req, res) {
  try {
    const { baseId, equipmentTypeId, from, to, limit, offset } = req.query;

    const allowed = await getAllowedBaseIds(req.user);
    if (allowed !== null && allowed.length === 0) return res.json({ data: [], meta: { count: 0 } });

    // If baseId provided, enforce base access
    if (baseId && !ensureBaseAllowed(allowed, baseId)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    let q = supabase
      .from("purchases")
      .select("*")
      .order("purchased_at", { ascending: false });

    if (baseId) q = q.eq("base_id", baseId);
    else if (allowed !== null) q = q.in("base_id", allowed);

    if (equipmentTypeId) q = q.eq("equipment_type_id", equipmentTypeId);
    if (from) q = q.gte("purchased_at", from);
    if (to) q = q.lte("purchased_at", to);

    const lim = Math.min(Number(limit || 20), 100);
    const off = Number(offset || 0);
    q = q.range(off, off + lim - 1);

    const { data, error } = await q;
    if (error) return res.status(500).json({ message: "db error", detail: error.message });

    return res.json({ data, meta: { limit: lim, offset: off } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}
