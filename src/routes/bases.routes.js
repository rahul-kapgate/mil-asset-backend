import { Router } from "express";
import { requireRole } from "../utils/rbac.middleware.js";
import { createBase, getBases } from "../controllers/masters.controller.js";

const router = Router();

// Anyone logged-in can list bases (filtered by RBAC rules inside controller)
router.get("/", getBases);

// Only ADMIN can create base
router.post("/", requireRole(["ADMIN"]), createBase);

export default router;
