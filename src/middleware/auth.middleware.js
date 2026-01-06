import { supabase } from "../config/supabase.js";
import { verifyAccessToken } from "../utils/jwt.js";

/**
 * Express auth middleware:
 * - Reads Authorization: Bearer <token>
 * - Verifies JWT
 * - Loads user from DB (authoritative role/base scope)
 * - Sets req.user = { id, email, role, base_id }
 */
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ message: "Missing or invalid Authorization header" });
    }

    const token = match[1];

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired access token" });
    }

    // Token payload should have `sub`
    const userId = decoded?.sub || decoded?.user_id || decoded?.id;
    if (!userId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    // Fetch authoritative user record (prevents stale role/base_id from token)
    const { data: user, error } = await supabase
      .from("users")
      .select("id,email,role,base_id")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ message: "db error", detail: error.message });
    }
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      base_id: user.base_id,
    };

    return next();
  } catch (err) {
    console.error("auth middleware error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
}
