import { supabase } from "../config/supabase.js";

/**
 * GET /api/v1/bases
 * RBAC:
 * - ADMIN: all bases
 * - BASE_COMMANDER: only their base (req.user.base_id)
 * - LOGISTICS_OFFICER: allowed bases from user_base_access (or fallback to base_id)
 */
export async function getBases(req, res) {
  try {
    const { role, base_id, id: user_id } = req.user;

    // ADMIN => all
    if (role === "ADMIN") {
      const { data, error } = await supabase
        .from("bases")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) return res.status(500).json({ message: "db error", detail: error.message });
      return res.json({ data });
    }

    // BASE_COMMANDER => own base only
    if (role === "BASE_COMMANDER") {
      if (!base_id) return res.json({ data: [] });

      const { data, error } = await supabase
        .from("bases")
        .select("*")
        .eq("id", base_id)
        .maybeSingle();

      if (error) return res.status(500).json({ message: "db error", detail: error.message });
      return res.json({ data: data ? [data] : [] });
    }

    // LOGISTICS_OFFICER => allowed bases (user_base_access)
    if (role === "LOGISTICS_OFFICER") {
      // Try allowed-base mapping first
      const { data: accessRows, error: accessErr } = await supabase
        .from("user_base_access")
        .select("base_id")
        .eq("user_id", user_id);

      if (!accessErr && accessRows && accessRows.length > 0) {
        const baseIds = accessRows.map((r) => r.base_id);

        const { data, error } = await supabase
          .from("bases")
          .select("*")
          .in("id", baseIds)
          .order("created_at", { ascending: false });

        if (error) return res.status(500).json({ message: "db error", detail: error.message });
        return res.json({ data });
      }

      // Fallback: if logistics has a base_id, show that single base
      if (base_id) {
        const { data, error } = await supabase
          .from("bases")
          .select("*")
          .eq("id", base_id)
          .maybeSingle();

        if (error) return res.status(500).json({ message: "db error", detail: error.message });
        return res.json({ data: data ? [data] : [] });
      }

      // No access mapping + no base_id
      return res.json({ data: [] });
    }

    return res.status(403).json({ message: "Forbidden: unknown role" });
  } catch (err) {
    console.error("getBases error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
}

/**
 * POST /api/v1/bases (ADMIN only)
 * body: { name, code, location? }
 */
export async function createBase(req, res) {
  try {
    const { name, code, location } = req.body || {};

    if (!name || !code) {
      return res.status(400).json({ message: "name and code are required" });
    }

    const { data, error } = await supabase
      .from("bases")
      .insert({ name, code, location: location || null })
      .select("*")
      .single();

    if (error) {
      // duplicate code -> 409 is nicer
      if (String(error.message || "").toLowerCase().includes("duplicate")) {
        return res.status(409).json({ message: "base code already exists" });
      }
      return res.status(500).json({ message: "db error", detail: error.message });
    }

    return res.status(201).json({ data });
  } catch (err) {
    console.error("createBase error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
}

/**
 * GET /api/v1/equipment-types
 * All roles can view equipment types
 */
export async function getEquipmentTypes(req, res) {
  try {
    const { data, error } = await supabase
      .from("equipment_types")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ message: "db error", detail: error.message });

    return res.json({ data });
  } catch (err) {
    console.error("getEquipmentTypes error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
}

/**
 * POST /api/v1/equipment-types (ADMIN only)
 * body: { name, category?, unit?, is_serialized? }
 */
export async function createEquipmentType(req, res) {
  try {
    const { name, category, unit, is_serialized } = req.body || {};

    if (!name) {
      return res.status(400).json({ message: "name is required" });
    }

    const payload = {
      name,
      category: category || null,
      unit: unit || "unit",
      is_serialized: Boolean(is_serialized),
    };

    const { data, error } = await supabase
      .from("equipment_types")
      .insert(payload)
      .select("*")
      .single();

    if (error) return res.status(500).json({ message: "db error", detail: error.message });

    return res.status(201).json({ data });
  } catch (err) {
    console.error("createEquipmentType error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
}
