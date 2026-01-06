import { Router } from "express";
import { login, register, refresh } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireRole } from "../utils/rbac.middleware.js";

const router = Router();

// Admin-only user creation (prevents role escalation)
router.post("/register", authenticate, requireRole(["ADMIN"]), register);

router.post("/login", login);
router.post("/refresh", refresh);

export default router;
