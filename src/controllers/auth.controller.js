import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";
import { signAccessToken, signRefreshToken } from "../utils/jwt.js";

/**
 * POST /api/auth/register
 * body: { email, password, role?, base_id? }
 */
export async function register(req, res) {
  try {
    const { email, password, role, base_id } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "password must be at least 6 chars" });
    }

    // Check if user already exists
    const { data: existing, error: existErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existErr) {
      return res.status(500).json({ message: "db error", detail: existErr.message });
    }
    if (existing) {
      return res.status(409).json({ message: "user already exists" });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const { data: created, error: createErr } = await supabase
      .from("users")
      .insert({
        email,
        password_hash,
        role: role || "LOGISTICS_OFFICER",
        base_id: base_id || null,
      })
      .select("id,email,role,base_id,created_at")
      .single();

    if (createErr) {
      return res.status(500).json({ message: "failed to create user", detail: createErr.message });
    }

    const payload = {
      sub: created.id,       // or user.id in login
      role: created.role,
      base_id: created.base_id,
    };
    
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ sub: payload.sub });
    
    return res.status(201).json({
      user: created,
      accessToken,
      refreshToken,
    });
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

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    // Fetch user by email
    const { data: user, error } = await supabase
      .from("users")
      .select("id,email,password_hash,role,base_id")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ message: "db error", detail: error.message });
    }
    if (!user) {
      return res.status(401).json({ message: "invalid credentials" });
    }

    // Compare passwords
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: "invalid credentials" });
    }

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

export async function refresh(req, res) {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ message: "refreshToken is required" });
    }

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
