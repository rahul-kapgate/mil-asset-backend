import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/rbac.middleware.js";
import { createBase, getBases } from "../controllers/masters.controller.js";

const router = Router();

// Anyone logged-in can list bases (filtered by RBAC rules inside controller)
router.get("/", authMiddleware, getBases);

// Only ADMIN can create base
router.post("/", authMiddleware, requireRole(["ADMIN"]), createBase);

export default router;
