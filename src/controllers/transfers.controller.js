import { supabase } from "../config/supabase.js";
import { ROLES, TRANSFER_STATUS, LEDGER_MOVE } from "../config/constants.js";
import { getAllowedBaseIds, ensureBaseAllowed } from "../utils/baseAccess.js";
import { writeAuditLog } from "../services/audit.service.js";

import { getLedgerBalance } from "../utils/ledger.js";

export async function createTransfer(req, res) {
  try {
    if (![ROLES.ADMIN, ROLES.LOGISTICS_OFFICER].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { from_base_id, to_base_id, notes, items } = req.body || {};
    if (!from_base_id || !to_base_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "from_base_id, to_base_id, items[] required" });
    }
    if (from_base_id === to_base_id) {
      return res.status(400).json({ message: "from_base_id and to_base_id must differ" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!ensureBaseAllowed(allowed, from_base_id)) {
      return res.status(403).json({ message: "Forbidden: no access to from_base" });
    }

    const { data: transfer, error: tErr } = await supabase
      .from("transfers")
      .insert({
        from_base_id,
        to_base_id,
        status: TRANSFER_STATUS.DRAFT,
        notes: notes || null,
        created_by: req.user.id,
      })
      .select("*")
      .single();

    if (tErr) return res.status(500).json({ message: "db error", detail: tErr.message });

    const normalized = items.map((it) => ({
      transfer_id: transfer.id,
      equipment_type_id: it.equipment_type_id,
      quantity: Number(it.quantity),
    }));

    if (normalized.some((x) => !x.equipment_type_id || !Number.isFinite(x.quantity) || x.quantity <= 0)) {
      return res.status(400).json({ message: "each item needs equipment_type_id and quantity > 0" });
    }

    const { error: iErr } = await supabase.from("transfer_items").insert(normalized);
    if (iErr) return res.status(500).json({ message: "items insert failed", detail: iErr.message });

    await writeAuditLog({
      action: "TRANSFER_CREATED",
      actor_id: req.user.id,
      base_id: from_base_id,
      entity_type: "transfer",
      entity_id: transfer.id,
      metadata: { to_base_id, items: normalized },
    });

    return res.status(201).json({ data: transfer });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function approveTransfer(req, res) {
  try {
    const transferId = req.params.id;

    // Admin OR Base commander of FROM base
    const { data: transfer, error: fErr } = await supabase
      .from("transfers")
      .select("*")
      .eq("id", transferId)
      .maybeSingle();

    if (fErr) return res.status(500).json({ message: "db error", detail: fErr.message });
    if (!transfer) return res.status(404).json({ message: "transfer not found" });

    if (transfer.status !== TRANSFER_STATUS.DRAFT) {
      return res.status(400).json({ message: "only DRAFT can be approved" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    const isAdmin = req.user.role === ROLES.ADMIN;
    const isCommanderFrom = req.user.role === ROLES.BASE_COMMANDER && req.user.base_id === transfer.from_base_id;

    if (!isAdmin && !isCommanderFrom) {
      return res.status(403).json({ message: "Forbidden: only Admin or From-Base Commander" });
    }
    if (!isAdmin && !ensureBaseAllowed(allowed, transfer.from_base_id)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    const { data: updated, error: uErr } = await supabase
      .from("transfers")
      .update({
        status: TRANSFER_STATUS.APPROVED,
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", transferId)
      .select("*")
      .single();

    if (uErr) return res.status(500).json({ message: "db error", detail: uErr.message });

    await writeAuditLog({
      action: "TRANSFER_APPROVED",
      actor_id: req.user.id,
      base_id: updated.from_base_id,
      entity_type: "transfer",
      entity_id: updated.id,
    });

    return res.json({ data: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function dispatchTransfer(req, res) {
  try {
    const transferId = req.params.id;

    if (![ROLES.ADMIN, ROLES.LOGISTICS_OFFICER].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { data: transfer, error: tErr } = await supabase
      .from("transfers")
      .select("*")
      .eq("id", transferId)
      .maybeSingle();

    if (tErr) return res.status(500).json({ message: "db error", detail: tErr.message });
    if (!transfer) return res.status(404).json({ message: "transfer not found" });

    if (transfer.status !== TRANSFER_STATUS.APPROVED) {
      return res.status(400).json({ message: "only APPROVED can be dispatched" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!ensureBaseAllowed(allowed, transfer.from_base_id)) {
      return res.status(403).json({ message: "Forbidden: no access to from_base" });
    }

    const { data: updated, error: uErr } = await supabase
      .from("transfers")
      .update({
        status: TRANSFER_STATUS.DISPATCHED,
        dispatched_by: req.user.id,
        dispatched_at: new Date().toISOString(),
      })
      .eq("id", transferId)
      .select("*")
      .single();

    if (uErr) return res.status(500).json({ message: "db error", detail: uErr.message });

    await writeAuditLog({
      action: "TRANSFER_DISPATCHED",
      actor_id: req.user.id,
      base_id: updated.from_base_id,
      entity_type: "transfer",
      entity_id: updated.id,
    });

    return res.json({ data: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function receiveTransfer(req, res) {
  try {
    const transferId = req.params.id;

    const { data: transfer, error: tErr } = await supabase
      .from("transfers")
      .select("*, transfer_items(*)")
      .eq("id", transferId)
      .maybeSingle();

    if (tErr) return res.status(500).json({ message: "db error", detail: tErr.message });
    if (!transfer) return res.status(404).json({ message: "transfer not found" });

    if (transfer.status !== TRANSFER_STATUS.DISPATCHED) {
      return res.status(400).json({ message: "only DISPATCHED can be received" });
    }

    const isAdmin = req.user.role === ROLES.ADMIN;
    const isCommanderTo = req.user.role === ROLES.BASE_COMMANDER && req.user.base_id === transfer.to_base_id;
    if (!isAdmin && !isCommanderTo) {
      return res.status(403).json({ message: "Forbidden: only Admin or To-Base Commander" });
    }

    const allowed = await getAllowedBaseIds(req.user);
    if (!isAdmin && !ensureBaseAllowed(allowed, transfer.to_base_id)) {
      return res.status(403).json({ message: "Forbidden: base access" });
    }

    const receivedAt = new Date().toISOString();

    // (Optional) Validate stock at from_base before receiving
    for (const item of transfer.transfer_items || []) {
      const bal = await getLedgerBalance(transfer.from_base_id, item.equipment_type_id);
      if (bal < item.quantity) {
        return res.status(400).json({
          message: "insufficient stock at from_base",
          detail: { equipment_type_id: item.equipment_type_id, required: item.quantity, available: bal },
        });
      }
    }

    // Update transfer to RECEIVED
    const { data: updated, error: uErr } = await supabase
      .from("transfers")
      .update({
        status: TRANSFER_STATUS.RECEIVED,
        received_by: req.user.id,
        received_at: receivedAt,
      })
      .eq("id", transferId)
      .select("*")
      .single();

    if (uErr) return res.status(500).json({ message: "db error", detail: uErr.message });

    // Ledger entries on receive:
    // - from_base: TRANSFER_OUT (-qty)
    // - to_base: TRANSFER_IN (+qty)
    const ledgerRows = [];
    for (const item of transfer.transfer_items || []) {
      ledgerRows.push({
        base_id: transfer.from_base_id,
        equipment_type_id: item.equipment_type_id,
        movement_type: LEDGER_MOVE.TRANSFER_OUT,
        qty_change: -Number(item.quantity),
        ref_type: "transfer",
        ref_id: transfer.id,
        occurred_at: receivedAt,
        created_by: req.user.id,
      });
      ledgerRows.push({
        base_id: transfer.to_base_id,
        equipment_type_id: item.equipment_type_id,
        movement_type: LEDGER_MOVE.TRANSFER_IN,
        qty_change: Number(item.quantity),
        ref_type: "transfer",
        ref_id: transfer.id,
        occurred_at: receivedAt,
        created_by: req.user.id,
      });
    }

    const { error: lErr } = await supabase.from("inventory_ledger").insert(ledgerRows);
    if (lErr) return res.status(500).json({ message: "ledger insert failed", detail: lErr.message });

    await writeAuditLog({
      action: "TRANSFER_RECEIVED",
      actor_id: req.user.id,
      base_id: updated.to_base_id,
      entity_type: "transfer",
      entity_id: updated.id,
      metadata: { ledgerRowsCount: ledgerRows.length },
    });

    return res.json({ data: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}

export async function listTransfers(req, res) {
  try {
    const { baseId, fromBaseId, toBaseId, from, to } = req.query;

    const allowed = await getAllowedBaseIds(req.user);
    if (allowed !== null && allowed.length === 0) return res.json({ data: [] });

    let q = supabase
      .from("transfers")
      .select("*, transfer_items(*)")
      .order("created_at", { ascending: false });

    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);

    if (fromBaseId) q = q.eq("from_base_id", fromBaseId);
    if (toBaseId) q = q.eq("to_base_id", toBaseId);

    if (baseId) {
      // show in/out for that base
      if (!ensureBaseAllowed(allowed, baseId)) return res.status(403).json({ message: "Forbidden: base access" });
      q = q.or(`from_base_id.eq.${baseId},to_base_id.eq.${baseId}`);
    } else if (allowed !== null) {
      // restrict to allowed bases (either side)
      const list = allowed.join(",");
      q = q.or(`from_base_id.in.(${list}),to_base_id.in.(${list})`);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ message: "db error", detail: error.message });

    return res.json({ data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "internal server error" });
  }
}
