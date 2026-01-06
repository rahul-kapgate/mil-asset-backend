import { Router } from "express";
import { requireRole } from "../utils/rbac.middleware.js";
import { createEquipmentType, getEquipmentTypes } from "../controllers/masters.controller.js";

const router = Router();

// Everyone logged in can view equipment types
router.get("/", getEquipmentTypes);

// ADMIN only create equipment type
router.post("/", requireRole(["ADMIN"]), createEquipmentType);

export default router;
