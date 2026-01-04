import { supabase } from "../config/supabase.js";
import { ROLES } from "../config/constants.js";

export async function listAuditLogs(req, res) {
  try {
    if (req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { from, to, actorId, action, baseId, limit, offset } = req.query;

    let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false });

    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    if (actorId) q = q.eq("actor_id", actorId);
    if (action) q = q.eq("action", action);
    if (baseId) q = q.eq("base_id", baseId);

    const lim = Math.min(Number(limit || 50), 200);
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
