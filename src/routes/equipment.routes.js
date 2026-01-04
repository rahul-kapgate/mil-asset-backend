import { Router } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { requireRole } from "../utils/rbac.middleware.js";
import { createEquipmentType, getEquipmentTypes } from "../controllers/masters.controller.js";

const router = Router();

// Everyone logged in can view equipment types
router.get("/", verifyAccessToken, getEquipmentTypes);

// ADMIN only create equipment type
router.post("/", verifyAccessToken, requireRole(["ADMIN"]), createEquipmentType);

export default router;
