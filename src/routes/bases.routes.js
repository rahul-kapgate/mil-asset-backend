    import { Router } from "express";
    import { verifyAccessToken } from "../utils/jwt.js";
import { requireRole } from "../utils/rbac.middleware.js";
import { createBase, getBases } from "../controllers/masters.controller.js";

const router = Router();

// Anyone logged-in can list bases (filtered by RBAC rules inside controller)
router.get("/", verifyAccessToken, getBases);

// Only ADMIN can create base
router.post("/", verifyAccessToken, requireRole(["ADMIN"]), createBase);

export default router;
