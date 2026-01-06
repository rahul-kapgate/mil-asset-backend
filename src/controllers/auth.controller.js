import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";
import { ROLES } from "../config/constants.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";

function isValidEmail(email) {
  // light validation (avoid rejecting real emails; DB should enforce uniqueness)
  return typeof email === "string" && email.includes("@") && email.length <= 254;
}

/**
 * POST /api/auth/register  (Admin-only)
 * body: { email, password, role, base_id? }
 */
export async function register(req, res) {
  try {
    // Defense-in-depth: route already requires ADMIN
    if (!req.user || req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { email, password, role, base_id } = req.body || {};

    if (!isValidEmail(email) || !password || !role) {
      return res.status(400).json({ message: "email, password, role are required" });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "password must be at least 6 chars" });
    }

    const allowedRoles = Object.values(ROLES);
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "invalid role" });
    }

    // Base commander must be bound to exactly one base
    if (role === ROLES.BASE_COMMANDER && !base_id) {
      return res.status(400).json({ message: "base_id is required for BASE_COMMANDER" });
    }

    // Check if user already exists
    const { data: existing, error: existErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", String(email).toLowerCase())
      .maybeSingle();

    if (existErr) {
      return res.status(500).json({ message: "db error", detail: existErr.message });
    }
    if (existing) {
      return res.status(409).json({ message: "email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data: user, error: createErr } = await supabase
      .from("users")
      .insert({
        email: String(email).toLowerCase(),
        password_hash,
        role,
        base_id: base_id || null,
      })
      .select("id,email,role,base_id")
      .single();

    if (createErr) {
      return res.status(500).json({ message: "db error", detail: createErr.message });
    }

    return res.status(201).json({ data: user });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
}

/**
 * POST /api/auth/login
 * body: { email, password }
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id,email,role,base_id,password_hash")
      .eq("email", String(email).toLowerCase())
      .maybeSingle();

    if (error) return res.status(500).json({ message: "db error", detail: error.message });
    if (!user) return res.status(401).json({ message: "invalid credentials" });

    const ok = await bcrypt.compare(String(password), user.password_hash || "");
    if (!ok) return res.status(401).json({ message: "invalid credentials" });

    const payload = { sub: user.id, role: user.role, base_id: user.base_id };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ sub: payload.sub });

    return res.json({
      user: { id: user.id, email: user.email, role: user.role, base_id: user.base_id },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
}

/**
 * POST /api/auth/refresh
 * body: { refreshToken }
 */
export async function refresh(req, res) {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ message: "refreshToken is required" });

    const decoded = verifyRefreshToken(refreshToken); // { sub, type, iat, exp }
    const userId = decoded.sub;

    // Fetch role/base_id fresh from DB (important!)
    const { data: user, error } = await supabase
      .from("users")
      .select("id,email,role,base_id")
      .eq("id", userId)
      .maybeSingle();

    if (error) return res.status(500).json({ message: "db error", detail: error.message });
    if (!user) return res.status(401).json({ message: "invalid refresh token" });

    const newAccessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      base_id: user.base_id,
    });

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(401).json({ message: "invalid or expired refresh token" });
  }
}
